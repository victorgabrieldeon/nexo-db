import pg from 'pg'
import Cursor from 'pg-cursor'
import type {
  ColumnInfo,
  CompletionSchema,
  ConnectionConfig,
  ConstraintInfo,
  DbObject,
  FieldInfo,
  ForeignKey,
  IndexInfo,
  ObjectKind,
  QueryError,
  QueryResult,
  RowChange,
  ServerInfo,
  TableDataRequest,
  TableDetails
} from '../shared/types'

/** Todos os valores chegam como texto cru: preserva precisão (numeric, int8) e o formato exato do Postgres. */
const rawTypes = { getTypeParser: () => (v: string) => v } as unknown as pg.CustomTypesConfig

const pools = new Map<string, pg.Pool>()
const typeNames = new Map<string, Map<number, string>>()
const passwords = new Map<string, string>()
let configs = new Map<string, ConnectionConfig>()

interface Session {
  client: pg.Client
  connId: string
  database: string
  pid: number
  busy: boolean
}
const sessions = new Map<string, Session>()

export function setConfigs(list: ConnectionConfig[]): void {
  configs = new Map(list.map((c) => [c.id, c]))
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function qualified(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`
}

function clientConfig(conn: ConnectionConfig, database?: string): pg.ClientConfig {
  const password = conn.password ?? passwords.get(conn.id)
  return {
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password,
    database: database || conn.database,
    ssl: conn.ssl === 'disable' ? false : conn.ssl === 'no-verify' ? { rejectUnauthorized: false } : true,
    connectionTimeoutMillis: 10_000,
    application_name: 'Nexo DB'
  }
}

function getConfig(connId: string): ConnectionConfig {
  const conn = configs.get(connId)
  if (!conn) throw new Error('Conexão não encontrada')
  return conn
}

function poolKey(connId: string, database: string): string {
  return `${connId}\u0000${database}`
}

function getPool(connId: string, database?: string): pg.Pool {
  const conn = getConfig(connId)
  const db = database || conn.database
  const key = poolKey(connId, db)
  let pool = pools.get(key)
  if (!pool) {
    pool = new pg.Pool({ ...clientConfig(conn, db), max: 4, idleTimeoutMillis: 60_000 })
    pool.on('error', () => {
      /* conexões ociosas derrubadas pelo servidor: o pool recria sob demanda */
    })
    pools.set(key, pool)
  }
  return pool
}

export function toQueryError(e: unknown): QueryError {
  const err = e as pg.DatabaseError & { message: string }
  return {
    message: err?.message ?? String(e),
    code: err?.code,
    position: err?.position ? Number(err.position) : undefined,
    detail: err?.detail,
    hint: err?.hint
  }
}

async function loadTypeNames(connId: string, database: string): Promise<Map<number, string>> {
  const key = poolKey(connId, database)
  const cached = typeNames.get(key)
  if (cached) return cached
  const { rows } = await getPool(connId, database).query<{ oid: number; typname: string }>(
    'select oid::int, typname from pg_type'
  )
  const map = new Map(rows.map((r) => [r.oid, r.typname]))
  typeNames.set(key, map)
  return map
}

function mapFields(fields: pg.FieldDef[] | undefined, names: Map<number, string>): FieldInfo[] {
  return (fields ?? []).map((f) => ({
    name: f.name,
    typeId: f.dataTypeID,
    typeName: names.get(f.dataTypeID) ?? String(f.dataTypeID),
    tableId: f.tableID ?? 0,
    columnId: f.columnID ?? 0
  }))
}

// ───────────────────────────── conexão ─────────────────────────────

export async function testConnection(conn: ConnectionConfig): Promise<ServerInfo> {
  const client = new pg.Client(clientConfig(conn))
  await client.connect()
  try {
    const { rows } = await client.query('select version() as v, current_database() as d, current_user as u')
    return { version: rows[0].v, database: rows[0].d, user: rows[0].u }
  } finally {
    await client.end().catch(() => {})
  }
}

export async function connect(connId: string, password?: string): Promise<ServerInfo> {
  if (password !== undefined) passwords.set(connId, password)
  const pool = getPool(connId)
  try {
    const { rows } = await pool.query(
      `select current_setting('server_version') as v, current_database() as d, current_user as u`
    )
    return { version: rows[0].v, database: rows[0].d, user: rows[0].u }
  } catch (e) {
    await disconnect(connId)
    throw e
  }
}

export async function disconnect(connId: string): Promise<void> {
  const ends: Promise<unknown>[] = []
  for (const [key, pool] of pools) {
    if (key.startsWith(`${connId}\u0000`)) {
      pools.delete(key)
      typeNames.delete(key)
      ends.push(pool.end().catch(() => {}))
    }
  }
  for (const [id, s] of sessions) {
    if (s.connId === connId) {
      sessions.delete(id)
      ends.push(s.client.end().catch(() => {}))
    }
  }
  await Promise.all(ends)
}

export async function disconnectAll(): Promise<void> {
  await Promise.all([...configs.keys()].map((id) => disconnect(id)))
}

export function needsPassword(connId: string): boolean {
  const conn = getConfig(connId)
  return !conn.password && !passwords.has(connId)
}

// ───────────────────────────── sessões (abas SQL) ─────────────────────────────

async function getSession(sessionId: string, connId: string, database: string): Promise<Session> {
  const existing = sessions.get(sessionId)
  if (existing && existing.connId === connId && existing.database === database) return existing
  if (existing) await closeSession(sessionId)

  const client = new pg.Client(clientConfig(getConfig(connId), database))
  await client.connect()
  const session: Session = {
    client,
    connId,
    database,
    pid: (client as unknown as { processID: number }).processID,
    busy: false
  }
  client.on('error', () => sessions.delete(sessionId))
  client.on('end', () => {
    if (sessions.get(sessionId) === session) sessions.delete(sessionId)
  })
  sessions.set(sessionId, session)
  return session
}

export async function closeSession(sessionId: string): Promise<void> {
  const s = sessions.get(sessionId)
  if (!s) return
  sessions.delete(sessionId)
  await s.client.end().catch(() => {})
}

export async function cancelSession(sessionId: string): Promise<boolean> {
  const s = sessions.get(sessionId)
  if (!s || !s.busy) return false
  const { rows } = await getPool(s.connId, s.database).query('select pg_cancel_backend($1) as ok', [s.pid])
  return rows[0]?.ok === true
}

function readCursor(cursor: Cursor, n: number): Promise<{ rows: unknown[][]; result: pg.QueryResult }> {
  return new Promise((resolve, reject) => {
    cursor.read(n, (err, rows, result) => (err ? reject(err) : resolve({ rows: rows as unknown[][], result })))
  })
}

function closeCursor(cursor: Cursor): Promise<void> {
  return new Promise((resolve) => cursor.close(() => resolve()))
}

const MULTI_COMMAND_ERROR = '42601'

export async function executeInSession(
  sessionId: string,
  connId: string,
  database: string,
  sql: string,
  maxRows: number
): Promise<QueryResult> {
  const session = await getSession(sessionId, connId, database)
  if (session.busy) throw new Error('Já existe uma consulta em execução nesta aba')
  const names = await loadTypeNames(connId, database)
  const { client } = session
  const notices: string[] = []
  const onNotice = (n: { message?: string; severity?: string }): void => {
    notices.push(`${n.severity ?? 'NOTICE'}: ${n.message}`)
  }
  client.on('notice', onNotice)
  session.busy = true
  const started = performance.now()
  try {
    try {
      // Cursor: busca só as primeiras `maxRows` linhas, sem carregar tabelas gigantes na memória.
      const cursor = client.query(new Cursor(sql, undefined, { rowMode: 'array', types: rawTypes }))
      const { rows, result } = await readCursor(cursor, maxRows + 1)
      const truncated = rows.length > maxRows
      if (truncated) await closeCursor(cursor)
      return {
        command: result.command ?? (truncated ? 'SELECT' : ''),
        rowCount: truncated ? null : (result.rowCount ?? rows.length),
        fields: mapFields(result.fields, names),
        rows: (truncated ? rows.slice(0, maxRows) : rows) as (string | null)[][],
        durationMs: performance.now() - started,
        truncated,
        notices
      }
    } catch (e) {
      // O protocolo estendido não aceita vários comandos num só envio: cai para o protocolo simples.
      if ((e as pg.DatabaseError).code !== MULTI_COMMAND_ERROR || !/multiple commands/i.test((e as Error).message)) throw e
      const res = (await client.query({ text: sql, rowMode: 'array', types: rawTypes })) as unknown as
        | pg.QueryResult
        | pg.QueryResult[]
      const last = Array.isArray(res) ? res[res.length - 1] : res
      return {
        command: last.command ?? '',
        rowCount: last.rowCount ?? last.rows.length,
        fields: mapFields(last.fields, names),
        rows: (last.rows as unknown as (string | null)[][]).slice(0, maxRows),
        durationMs: performance.now() - started,
        truncated: last.rows.length > maxRows,
        notices
      }
    }
  } finally {
    session.busy = false
    client.off('notice', onNotice)
  }
}

export function sessionInTransaction(sessionId: string): boolean {
  // status vem da última mensagem ReadyForQuery: 'I' ocioso, 'T' em transação, 'E' transação com erro
  const client = sessions.get(sessionId)?.client as unknown as { getTransactionStatus?: () => string | null }
  const status = client?.getTransactionStatus?.()
  return status === 'T' || status === 'E'
}

// ───────────────────────────── metadados ─────────────────────────────

export async function listDatabases(connId: string): Promise<string[]> {
  const { rows } = await getPool(connId).query<{ datname: string }>(
    'select datname from pg_database where not datistemplate and datallowconn order by datname'
  )
  return rows.map((r) => r.datname)
}

export async function listSchemas(connId: string, database: string): Promise<string[]> {
  const { rows } = await getPool(connId, database).query<{ nspname: string }>(
    `select nspname from pg_namespace
     where nspname not in ('information_schema') and nspname not like 'pg\\_%'
     order by nspname = 'public' desc, nspname`
  )
  return rows.map((r) => r.nspname)
}

const relkindMap: Record<string, ObjectKind> = {
  r: 'table',
  p: 'partitioned',
  v: 'view',
  m: 'matview',
  f: 'foreign',
  S: 'sequence'
}

export async function listObjects(connId: string, database: string, schema: string): Promise<DbObject[]> {
  const pool = getPool(connId, database)
  const [rels, funcs] = await Promise.all([
    pool.query<{ name: string; kind: string; comment: string | null; estimate: string }>(
      `select c.relname as name, c.relkind as kind, obj_description(c.oid, 'pg_class') as comment,
              greatest(c.reltuples, 0)::bigint as estimate
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = $1 and c.relkind in ('r','p','v','m','f','S') and not c.relispartition
       order by c.relname`,
      [schema]
    ),
    pool.query<{ name: string; args: string; comment: string | null }>(
      `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args,
              obj_description(p.oid, 'pg_proc') as comment
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = $1 and p.prokind in ('f','p')
         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       order by p.proname`,
      [schema]
    )
  ])
  return [
    ...rels.rows.map((r) => ({
      name: r.name,
      kind: relkindMap[r.kind] ?? 'table',
      comment: r.comment,
      rowEstimate: Number(r.estimate)
    })),
    ...funcs.rows.map((f) => ({ name: f.name, kind: 'function' as const, args: f.args, comment: f.comment }))
  ]
}

export async function tableDetails(
  connId: string,
  database: string,
  schema: string,
  table: string
): Promise<TableDetails> {
  const pool = getPool(connId, database)
  const rel = `to_regclass(format('%I.%I', $1::text, $2::text))`
  const [cols, idx, cons, meta] = await Promise.all([
    pool.query(
      `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, not a.attnotnull as nullable,
              pg_get_expr(d.adbin, d.adrelid) as "default", col_description(a.attrelid, a.attnum) as comment,
              a.attnum as position, coalesce(a.attnum = any(pk.conkey), false) as is_pk
       from pg_attribute a
       left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       left join pg_constraint pk on pk.conrelid = a.attrelid and pk.contype = 'p'
       where a.attrelid = ${rel} and a.attnum > 0 and not a.attisdropped
       order by a.attnum`,
      [schema, table]
    ),
    pool.query(
      `select i.relname as name, pg_get_indexdef(i.oid) as definition, x.indisunique as is_unique,
              x.indisprimary as is_primary, pg_relation_size(i.oid) as size
       from pg_index x join pg_class i on i.oid = x.indexrelid
       where x.indrelid = ${rel} order by x.indisprimary desc, i.relname`,
      [schema, table]
    ),
    pool.query(
      `select conname as name, contype as type, pg_get_constraintdef(oid, true) as definition
       from pg_constraint where conrelid = ${rel}
       order by array_position(array['p','u','f','c','x'], contype::text), conname`,
      [schema, table]
    ),
    pool.query(
      `select case when c.relkind in ('r','p','m') then pg_total_relation_size(c.oid) end as size,
              greatest(c.reltuples, 0)::bigint as estimate, obj_description(c.oid, 'pg_class') as comment
       from pg_class c where c.oid = ${rel}`,
      [schema, table]
    )
  ])
  const columns: ColumnInfo[] = cols.rows.map((r) => ({
    name: r.name,
    type: r.type,
    nullable: r.nullable,
    default: r.default,
    comment: r.comment,
    position: r.position,
    isPrimaryKey: r.is_pk
  }))
  const indexes: IndexInfo[] = idx.rows.map((r) => ({
    name: r.name,
    definition: r.definition,
    isUnique: r.is_unique,
    isPrimary: r.is_primary,
    sizeBytes: Number(r.size)
  }))
  const constraints: ConstraintInfo[] = cons.rows.map((r) => ({ name: r.name, type: r.type, definition: r.definition }))
  const m = meta.rows[0]
  return {
    columns,
    indexes,
    constraints,
    sizeBytes: m?.size != null ? Number(m.size) : null,
    rowEstimate: m ? Number(m.estimate) : null,
    comment: m?.comment ?? null
  }
}

export async function getDdl(
  connId: string,
  database: string,
  schema: string,
  name: string,
  kind: ObjectKind,
  args?: string
): Promise<string> {
  const pool = getPool(connId, database)
  const fq = qualified(schema, name)

  if (kind === 'function') {
    const { rows } = await pool.query(
      `select pg_get_functiondef(p.oid) as def
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = $1 and p.proname = $2 and pg_get_function_identity_arguments(p.oid) = $3`,
      [schema, name, args ?? '']
    )
    return `${rows[0]?.def ?? ''};`
  }

  if (kind === 'view' || kind === 'matview') {
    const { rows } = await pool.query(
      `select pg_get_viewdef(to_regclass(format('%I.%I', $1::text, $2::text)), true) as def`,
      [schema, name]
    )
    const head = kind === 'view' ? 'CREATE OR REPLACE VIEW' : 'CREATE MATERIALIZED VIEW'
    return `${head} ${fq} AS\n${String(rows[0]?.def ?? '').trimEnd()}`
  }

  if (kind === 'sequence') {
    const { rows } = await pool.query(
      `select data_type, start_value, min_value, max_value, increment_by, cycle, cache_size
       from pg_sequences where schemaname = $1 and sequencename = $2`,
      [schema, name]
    )
    const s = rows[0]
    if (!s) return ''
    return [
      `CREATE SEQUENCE ${fq}`,
      `  AS ${s.data_type}`,
      `  INCREMENT BY ${s.increment_by}`,
      `  MINVALUE ${s.min_value}`,
      `  MAXVALUE ${s.max_value}`,
      `  START WITH ${s.start_value}`,
      `  CACHE ${s.cache_size}`,
      `  ${s.cycle ? 'CYCLE' : 'NO CYCLE'};`
    ].join('\n')
  }

  const details = await tableDetails(connId, database, schema, name)
  const lines = details.columns.map((c) => {
    let line = `  ${quoteIdent(c.name)} ${c.type}`
    if (c.default != null) line += ` DEFAULT ${c.default}`
    if (!c.nullable) line += ' NOT NULL'
    return line
  })
  for (const c of details.constraints) {
    lines.push(`  CONSTRAINT ${quoteIdent(c.name)} ${c.definition}`)
  }
  const { rows: idxOnly } = await pool.query(
    `select pg_get_indexdef(x.indexrelid) as def from pg_index x
     where x.indrelid = to_regclass(format('%I.%I', $1::text, $2::text))
       and not exists (select 1 from pg_constraint k where k.conindid = x.indexrelid)`,
    [schema, name]
  )
  const out = [`CREATE TABLE ${fq} (\n${lines.join(',\n')}\n);`]
  for (const r of idxOnly) out.push(`${r.def};`)
  const literal = (s: string): string => `'${s.replace(/'/g, "''")}'`
  if (details.comment) out.push(`COMMENT ON TABLE ${fq} IS ${literal(details.comment)};`)
  for (const c of details.columns) {
    if (c.comment) out.push(`COMMENT ON COLUMN ${fq}.${quoteIdent(c.name)} IS ${literal(c.comment)};`)
  }
  return out.join('\n\n')
}

export async function completionSchema(connId: string, database: string): Promise<CompletionSchema> {
  const pool = getPool(connId, database)
  const [schemas, tables, funcs] = await Promise.all([
    listSchemas(connId, database),
    pool.query<{ schema: string; name: string; kind: string; columns: [string, string][] }>(
      `select n.nspname as schema, c.relname as name, c.relkind as kind,
              coalesce(json_agg(json_build_array(a.attname, format_type(a.atttypid, a.atttypmod)) order by a.attnum)
                       filter (where a.attname is not null), '[]') as columns
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
       where c.relkind in ('r','p','v','m','f') and not c.relispartition
         and n.nspname not in ('information_schema') and n.nspname not like 'pg\\_%'
       group by 1, 2, 3
       order by 1, 2
       limit 5000`
    ),
    pool.query<{ schema: string; name: string; args: string; returns: string }>(
      `select n.nspname as schema, p.proname as name, pg_get_function_arguments(p.oid) as args,
              pg_get_function_result(p.oid) as returns
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname not in ('information_schema', 'pg_catalog') and n.nspname not like 'pg\\_%'
         and p.prokind in ('f','p')
       order by 1, 2
       limit 3000`
    )
  ])
  return {
    schemas,
    tables: tables.rows.map((t) => ({
      schema: t.schema,
      name: t.name,
      kind: relkindMap[t.kind] ?? 'table',
      columns: t.columns.map(([name, type]) => ({ name, type }))
    })),
    functions: funcs.rows
  }
}

/**
 * FKs ligadas às tabelas informadas (por OID).
 * 'out': FKs declaradas nelas (apontam para outras); 'in': FKs de outras tabelas que apontam para elas.
 */
export async function foreignKeys(
  connId: string,
  database: string,
  tableOids: number[],
  direction: 'out' | 'in' = 'out'
): Promise<ForeignKey[]> {
  if (!tableOids.length) return []
  const { rows } = await getPool(connId, database).query<{
    name: string
    table_oid: number
    schema: string
    table: string
    attnums: number[]
    columns: string[]
    ref_table_oid: number
    ref_schema: string
    ref_table: string
    ref_attnums: number[]
    ref_columns: string[]
  }>(
    `select c.conname as name,
            c.conrelid::int as table_oid, sn.nspname as schema, sc.relname as table, c.conkey::int[] as attnums,
            (select array_agg(a.attname::text order by k.ord)
               from unnest(c.conkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as columns,
            c.confrelid::int as ref_table_oid, rn.nspname as ref_schema, rc.relname as ref_table,
            c.confkey::int[] as ref_attnums,
            (select array_agg(a.attname::text order by k.ord)
               from unnest(c.confkey) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as ref_columns
     from pg_constraint c
     join pg_class sc on sc.oid = c.conrelid
     join pg_namespace sn on sn.oid = sc.relnamespace
     join pg_class rc on rc.oid = c.confrelid
     join pg_namespace rn on rn.oid = rc.relnamespace
     where c.contype = 'f' and ${direction === 'out' ? 'c.conrelid' : 'c.confrelid'} = any($1::oid[])
     order by sn.nspname, sc.relname, c.conname`,
    [tableOids]
  )
  return rows.map((r) => ({
    name: r.name,
    tableOid: r.table_oid,
    schema: r.schema,
    table: r.table,
    attnums: r.attnums,
    columns: r.columns,
    refTableOid: r.ref_table_oid,
    refSchema: r.ref_schema,
    refTable: r.ref_table,
    refAttnums: r.ref_attnums,
    refColumns: r.ref_columns
  }))
}

// ───────────────────────────── dados de tabela ─────────────────────────────

export async function tableData(
  connId: string,
  database: string,
  req: TableDataRequest
): Promise<QueryResult> {
  const names = await loadTypeNames(connId, database)
  const pool = getPool(connId, database)
  let sql = `select * from ${qualified(req.schema, req.table)}`
  if (req.where?.trim()) sql += ` where ${req.where}`
  if (req.orderBy) {
    sql += ` order by ${quoteIdent(req.orderBy.column)} ${req.orderBy.dir === 'desc' ? 'desc' : 'asc'}`
  } else {
    // sem ordenação explícita, ordena pela PK para a paginação por OFFSET ser estável
    const { rows: pk } = await pool.query<{ attname: string }>(
      `select a.attname from pg_index i
       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
       where i.indrelid = to_regclass(format('%I.%I', $1::text, $2::text)) and i.indisprimary
       order by array_position(i.indkey::int2[], a.attnum)`,
      [req.schema, req.table]
    )
    if (pk.length) sql += ` order by ${pk.map((r) => quoteIdent(r.attname)).join(', ')}`
  }
  sql += ` limit ${Math.max(1, Math.floor(req.limit))} offset ${Math.max(0, Math.floor(req.offset))}`
  const started = performance.now()
  const res = await pool.query({ text: sql, rowMode: 'array', types: rawTypes })
  return {
    command: 'SELECT',
    rowCount: res.rowCount,
    fields: mapFields(res.fields, names),
    rows: res.rows as unknown as (string | null)[][],
    durationMs: performance.now() - started,
    truncated: false,
    notices: []
  }
}

export async function countRows(
  connId: string,
  database: string,
  schema: string,
  table: string,
  where?: string,
  /** para de contar ao atingir esse número (contagem barata em tabelas grandes) */
  cap?: number
): Promise<number> {
  let inner = `select 1 from ${qualified(schema, table)}`
  if (where?.trim()) inner += ` where ${where}`
  const sql = cap
    ? `select count(*) as n from (${inner} limit ${Math.max(1, Math.floor(cap))}) s`
    : `select count(*) as n from (${inner}) s`
  const { rows } = await getPool(connId, database).query(sql)
  return Number(rows[0].n)
}

/** Valores distintos de uma coluna com a frequência de cada um (mais frequentes primeiro). */
export async function columnDistinct(
  connId: string,
  database: string,
  schema: string,
  table: string,
  column: string,
  where?: string,
  limit = 500
): Promise<{ value: string | null; count: number }[]> {
  const col = quoteIdent(column)
  let sql = `select ${col}::text as value, count(*) as n from ${qualified(schema, table)}`
  if (where?.trim()) sql += ` where ${where}`
  sql += ` group by 1 order by 2 desc, 1 limit ${Math.max(1, Math.floor(limit))}`
  const { rows } = await getPool(connId, database).query(sql)
  return rows.map((r) => ({ value: r.value, count: Number(r.n) }))
}

/** Resumo de uma coluna: totais, nulos, distintos e (quando o tipo permite) mín/máx/média. */
export async function columnStats(
  connId: string,
  database: string,
  schema: string,
  table: string,
  column: string,
  opts: { where?: string; minMax: boolean; avg: boolean }
): Promise<{ total: number; nulls: number; distinct: number; min: string | null; max: string | null; avg: string | null }> {
  const col = quoteIdent(column)
  let sql = `select count(*) as total, count(${col}) as present, count(distinct ${col}::text) as distinct_n,
    ${opts.minMax ? `min(${col})::text` : 'null'} as min, ${opts.minMax ? `max(${col})::text` : 'null'} as max,
    ${opts.avg ? `round(avg(${col})::numeric, 4)::text` : 'null'} as avg
    from ${qualified(schema, table)}`
  if (opts.where?.trim()) sql += ` where ${opts.where}`
  const { rows } = await getPool(connId, database).query(sql)
  const r = rows[0]
  return {
    total: Number(r.total),
    nulls: Number(r.total) - Number(r.present),
    distinct: Number(r.distinct_n),
    min: r.min,
    max: r.max,
    avg: r.avg
  }
}

export async function applyChanges(
  connId: string,
  database: string,
  schema: string,
  table: string,
  changes: RowChange[]
): Promise<number> {
  const fq = qualified(schema, table)
  const client = await getPool(connId, database).connect()
  let affected = 0
  try {
    await client.query('begin')
    for (const ch of changes) {
      const params: (string | null)[] = []
      const p = (v: string | null): string => {
        params.push(v)
        return `$${params.length}`
      }
      const whereKey = (): string =>
        Object.entries(ch.key ?? {})
          .map(([k, v]) => (v === null ? `${quoteIdent(k)} is null` : `${quoteIdent(k)} = ${p(v)}`))
          .join(' and ')

      let sql: string
      if (ch.kind === 'insert') {
        const entries = Object.entries(ch.values ?? {})
        sql = entries.length
          ? `insert into ${fq} (${entries.map(([k]) => quoteIdent(k)).join(', ')}) values (${entries.map(([, v]) => p(v)).join(', ')})`
          : `insert into ${fq} default values`
      } else if (ch.kind === 'update') {
        const sets = Object.entries(ch.values ?? {}).map(([k, v]) => `${quoteIdent(k)} = ${p(v)}`)
        if (!sets.length) continue
        sql = `update ${fq} set ${sets.join(', ')} where ${whereKey()}`
      } else {
        sql = `delete from ${fq} where ${whereKey()}`
      }
      const res = await client.query(sql, params)
      if (ch.kind !== 'insert' && res.rowCount !== 1) {
        throw new Error(`A alteração afetaria ${res.rowCount} linhas em vez de 1 — operação desfeita.`)
      }
      affected += res.rowCount ?? 0
    }
    await client.query('commit')
    return affected
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}
