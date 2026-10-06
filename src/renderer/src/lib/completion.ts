import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import { PostgreSQL, schemaCompletionSource, type SQLNamespace } from '@codemirror/lang-sql'
import type { Extension } from '@codemirror/state'
import type { CompletionSchema, CompletionTable } from '@shared/types'
import { statementAt } from './sqlSplit'

const KEYWORDS = `select from where and or not in is null like ilike between exists as on join left right inner
full outer cross lateral natural using group by order having limit offset fetch first next rows only distinct all any some
union intersect except insert into values default update set delete returning with recursive case when then else end
create table view materialized index unique primary key foreign references constraint check alter add drop column rename
to cascade restrict if truncate grant revoke begin commit rollback savepoint transaction explain analyze verbose
vacuum reindex cluster comment schema sequence function procedure trigger extension type enum domain language
returns plpgsql do declare raise notice exception perform loop for while return asc desc nulls last over partition
window filter within cast true false current_date current_timestamp current_user now interval similar escape
conflict nothing tablespace owner security definer immutable stable volatile strict concurrently refresh listen notify
copy show reset temporary temp unlogged generated always identity stored collate`.split(/\s+/)

const BUILTIN_FUNCTIONS: [string, string][] = [
  ['count', 'agregação'], ['sum', 'agregação'], ['avg', 'agregação'], ['min', 'agregação'], ['max', 'agregação'],
  ['array_agg', 'agregação'], ['string_agg', 'agregação'], ['json_agg', 'agregação'], ['jsonb_agg', 'agregação'],
  ['json_object_agg', 'agregação'], ['jsonb_object_agg', 'agregação'], ['bool_and', 'agregação'], ['bool_or', 'agregação'],
  ['stddev', 'agregação'], ['variance', 'agregação'], ['percentile_cont', 'agregação'], ['mode', 'agregação'],
  ['row_number', 'janela'], ['rank', 'janela'], ['dense_rank', 'janela'], ['lag', 'janela'], ['lead', 'janela'],
  ['first_value', 'janela'], ['last_value', 'janela'], ['ntile', 'janela'], ['nth_value', 'janela'],
  ['coalesce', 'condicional'], ['nullif', 'condicional'], ['greatest', 'condicional'], ['least', 'condicional'],
  ['now', 'data/hora'], ['current_date', 'data/hora'], ['date_trunc', 'data/hora'], ['date_part', 'data/hora'],
  ['extract', 'data/hora'], ['age', 'data/hora'], ['to_char', 'formatação'], ['to_date', 'formatação'],
  ['to_timestamp', 'formatação'], ['to_number', 'formatação'], ['make_date', 'data/hora'], ['make_interval', 'data/hora'],
  ['clock_timestamp', 'data/hora'], ['generate_series', 'conjunto'], ['unnest', 'conjunto'],
  ['length', 'texto'], ['lower', 'texto'], ['upper', 'texto'], ['trim', 'texto'], ['btrim', 'texto'], ['ltrim', 'texto'],
  ['rtrim', 'texto'], ['substring', 'texto'], ['substr', 'texto'], ['replace', 'texto'], ['concat', 'texto'],
  ['concat_ws', 'texto'], ['split_part', 'texto'], ['position', 'texto'], ['left', 'texto'], ['right', 'texto'],
  ['lpad', 'texto'], ['rpad', 'texto'], ['initcap', 'texto'], ['format', 'texto'], ['md5', 'texto'], ['reverse', 'texto'],
  ['regexp_replace', 'regex'], ['regexp_matches', 'regex'], ['regexp_split_to_array', 'regex'], ['string_to_array', 'array'],
  ['array_to_string', 'array'], ['array_length', 'array'], ['array_append', 'array'], ['array_remove', 'array'],
  ['cardinality', 'array'], ['abs', 'matemática'], ['round', 'matemática'], ['ceil', 'matemática'], ['floor', 'matemática'],
  ['trunc', 'matemática'], ['mod', 'matemática'], ['power', 'matemática'], ['sqrt', 'matemática'], ['random', 'matemática'],
  ['jsonb_build_object', 'json'], ['json_build_object', 'json'], ['jsonb_build_array', 'json'], ['jsonb_set', 'json'],
  ['jsonb_each', 'json'], ['jsonb_array_elements', 'json'], ['jsonb_array_length', 'json'], ['jsonb_typeof', 'json'],
  ['jsonb_pretty', 'json'], ['jsonb_strip_nulls', 'json'], ['jsonb_path_query', 'json'], ['to_jsonb', 'json'], ['to_json', 'json'],
  ['row_to_json', 'json'], ['gen_random_uuid', 'uuid'], ['pg_size_pretty', 'sistema'], ['pg_total_relation_size', 'sistema'],
  ['pg_relation_size', 'sistema'], ['pg_database_size', 'sistema'], ['pg_cancel_backend', 'sistema'],
  ['pg_terminate_backend', 'sistema'], ['current_setting', 'sistema'], ['set_config', 'sistema'], ['nextval', 'sequência'],
  ['currval', 'sequência'], ['setval', 'sequência'], ['version', 'sistema'], ['pg_typeof', 'sistema']
]

const TABLE_CONTEXT = new Set(['from', 'join', 'update', 'into', 'table', 'truncate'])
const COLUMN_CONTEXT = new Set(['select', 'where', 'and', 'or', 'by', 'on', 'set', 'having', 'when', 'then', 'else', 'returning', 'distinct', 'not'])

function previousKeyword(text: string): string | null {
  // ignora a palavra sendo digitada e pega a última palavra-chave/pontuação significativa
  const m = /([A-Za-z_]+|,|\()\s*[\w"]*$/.exec(text)
  return m ? m[1].toLowerCase() : null
}

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)`
const TABLE_REF = new RegExp(
  String.raw`\b(?:from|join|update|into)\s+(${IDENT}(?:\s*\.\s*${IDENT})?)`,
  'gi'
)

function unquote(id: string): string {
  return id.startsWith('"') ? id.slice(1, -1).replace(/""/g, '"') : id.toLowerCase()
}

interface Index {
  byName: Map<string, CompletionTable[]>
  byQualified: Map<string, CompletionTable>
}

function buildIndex(schema: CompletionSchema): Index {
  const byName = new Map<string, CompletionTable[]>()
  const byQualified = new Map<string, CompletionTable>()
  for (const t of schema.tables) {
    byQualified.set(`${t.schema}.${t.name}`, t)
    const list = byName.get(t.name) ?? []
    list.push(t)
    byName.set(t.name, list)
  }
  return { byName, byQualified }
}

/** Tabelas referenciadas no comando atual (FROM/JOIN/UPDATE/INTO). */
function referencedTables(stmt: string, index: Index): CompletionTable[] {
  const found: CompletionTable[] = []
  for (const m of stmt.matchAll(TABLE_REF)) {
    const parts = m[1].split(/\s*\.\s*/).map(unquote)
    const t =
      parts.length === 2
        ? index.byQualified.get(`${parts[0]}.${parts[1]}`)
        : (index.byName.get(parts[0])?.find((x) => x.schema === 'public') ?? index.byName.get(parts[0])?.[0])
    if (t && !found.includes(t)) found.push(t)
  }
  return found
}

function columnsInScope(index: Index): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const word = ctx.matchBefore(/[\w$]*/)
    if (!word) return null
    const before = ctx.state.sliceDoc(Math.max(0, word.from - 1), word.from)
    if (before === '.' || before === '"') return null
    const doc = ctx.state.doc.toString()
    const stmt = statementAt(doc, ctx.pos)
    if (!stmt) return null
    const prev = previousKeyword(doc.slice(stmt.from, ctx.pos))
    if (prev && TABLE_CONTEXT.has(prev)) return null
    if (word.from === word.to && !ctx.explicit && !(prev && (COLUMN_CONTEXT.has(prev) || prev === ','))) return null

    const tables = referencedTables(stmt.text, index)
    if (!tables.length) return null
    const multi = tables.length > 1
    const options: Completion[] = []
    for (const t of tables) {
      for (const c of t.columns) {
        options.push({
          label: c.name,
          type: 'property',
          detail: multi ? `${c.type} · ${t.name}` : c.type,
          boost: 40
        })
      }
    }
    return { from: word.from, options, validFor: /^[\w$]*$/ }
  }
}

function keywordSource(): CompletionSource {
  const options: Completion[] = KEYWORDS.map((k) => ({ label: k.toUpperCase(), type: 'keyword', boost: -2 }))
  return (ctx) => {
    const word = ctx.matchBefore(/[A-Za-z_]\w*/)
    if (!word && !ctx.explicit) return null
    const from = word?.from ?? ctx.pos
    if (ctx.state.sliceDoc(from - 1, from) === '.') return null
    return { from, options, validFor: /^\w*$/ }
  }
}

function functionSource(schema: CompletionSchema): CompletionSource {
  const apply = (name: string) => (view: import('@codemirror/view').EditorView, _c: Completion, from: number, to: number) => {
    const hasParen = view.state.sliceDoc(to, to + 1) === '('
    const insert = hasParen ? name : `${name}()`
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + name.length + (hasParen ? 0 : 1) }
    })
  }
  const options: Completion[] = [
    ...BUILTIN_FUNCTIONS.map(([name, cat]) => ({ label: name, type: 'function', detail: cat, apply: apply(name), boost: -4 })),
    ...schema.functions.map((f) => ({
      label: f.name,
      type: 'function',
      detail: f.schema === 'public' ? f.returns : `${f.schema} · ${f.returns}`,
      info: `${f.schema}.${f.name}(${f.args}) → ${f.returns}`,
      apply: apply(f.schema === 'public' ? f.name : `${f.schema}.${f.name}`),
      boost: -3
    }))
  ]
  return (ctx) => {
    const word = ctx.matchBefore(/[A-Za-z_]\w*/)
    if (!word) return null
    if (ctx.state.sliceDoc(word.from - 1, word.from) === '.') return null
    const stmt = statementAt(ctx.state.doc.toString(), ctx.pos)
    const prev = stmt ? previousKeyword(ctx.state.sliceDoc(stmt.from, ctx.pos)) : null
    if (prev && TABLE_CONTEXT.has(prev)) return null
    return { from: word.from, options, validFor: /^\w*$/ }
  }
}

/** Envolve a fonte do lang-sql para priorizar tabelas depois de FROM/JOIN e colunas no resto. */
function contextualSchemaSource(ns: SQLNamespace): CompletionSource {
  const base = schemaCompletionSource({ dialect: PostgreSQL, schema: ns, defaultSchema: 'public' })
  return async (ctx) => {
    const res = await base(ctx)
    if (!res) return res
    const afterDot = ctx.state.sliceDoc(res.from - 1, res.from) === '.'
    if (afterDot) return { ...res, options: res.options.map((o) => ({ ...o, boost: 50 })) }
    const stmt = statementAt(ctx.state.doc.toString(), ctx.pos)
    const prev = stmt ? previousKeyword(ctx.state.sliceDoc(stmt.from, ctx.pos)) : null
    const tableCtx = !!prev && TABLE_CONTEXT.has(prev)
    if (!tableCtx && res.from === ctx.pos && !ctx.explicit) return null
    return {
      ...res,
      options: res.options.map((o) => ({
        ...o,
        boost: tableCtx ? (o.type === 'namespace' ? 45 : 50) : o.type === 'constant' ? 10 : -8
      }))
    }
  }
}

function buildNamespace(schema: CompletionSchema): SQLNamespace {
  const ns: Record<string, { self: Completion; children: Record<string, SQLNamespace> }> = {}
  for (const s of schema.schemas) ns[s] = { self: { label: s, type: 'namespace', detail: 'schema' }, children: {} }
  for (const t of schema.tables) {
    const parent = (ns[t.schema] ??= { self: { label: t.schema, type: 'namespace', detail: 'schema' }, children: {} })
    parent.children[t.name] = {
      self: {
        label: t.name,
        type: t.kind === 'table' || t.kind === 'partitioned' ? 'type' : 'class',
        detail: t.kind === 'table' || t.kind === 'partitioned' ? `tabela · ${t.schema}` : `${t.kind === 'matview' ? 'mat. view' : 'view'} · ${t.schema}`
      },
      children: t.columns.map((c) => ({ label: c.name, type: 'property', detail: c.type }))
    }
  }
  return ns as unknown as SQLNamespace
}

export function completionExtension(schema: CompletionSchema | null): Extension {
  const s: CompletionSchema = schema ?? { schemas: [], tables: [], functions: [] }
  const index = buildIndex(s)
  const sources = [contextualSchemaSource(buildNamespace(s)), columnsInScope(index), keywordSource(), functionSource(s)]
  return sources.map((src) => PostgreSQL.language.data.of({ autocomplete: src }))
}
