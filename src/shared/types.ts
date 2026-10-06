export type SslMode = 'disable' | 'require' | 'no-verify'

export interface ConnectionConfig {
  id: string
  name: string
  host: string
  port: number
  database: string
  user: string
  password?: string
  savePassword: boolean
  ssl: SslMode
  color: string
}

export interface ServerInfo {
  version: string
  database: string
  user: string
}

export interface FieldInfo {
  name: string
  typeId: number
  typeName: string
  /** OID da tabela de origem (0 quando a coluna é calculada) */
  tableId: number
  /** número da coluna (attnum) na tabela de origem */
  columnId: number
}

export interface ForeignKey {
  name: string
  /** tabela que contém a FK (origem) */
  tableOid: number
  schema: string
  table: string
  /** attnums das colunas da FK, na ordem da constraint */
  attnums: number[]
  columns: string[]
  /** tabela referenciada (destino) */
  refTableOid: number
  refSchema: string
  refTable: string
  refAttnums: number[]
  refColumns: string[]
}

export interface QueryResult {
  command: string
  rowCount: number | null
  fields: FieldInfo[]
  rows: (string | null)[][]
  durationMs: number
  truncated: boolean
  notices: string[]
}

export interface QueryError {
  message: string
  code?: string
  position?: number
  detail?: string
  hint?: string
}

export type QueryResponse = { ok: true; result: QueryResult } | { ok: false; error: QueryError }

export type ObjectKind = 'table' | 'view' | 'matview' | 'foreign' | 'partitioned' | 'function' | 'sequence'

export interface DbObject {
  name: string
  kind: ObjectKind
  comment?: string | null
  /** função: assinatura dos argumentos */
  args?: string
  rowEstimate?: number
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  default: string | null
  isPrimaryKey: boolean
  comment: string | null
  position: number
}

export interface IndexInfo {
  name: string
  definition: string
  isUnique: boolean
  isPrimary: boolean
  sizeBytes: number
}

export interface ConstraintInfo {
  name: string
  type: 'p' | 'f' | 'u' | 'c' | 'x' | string
  definition: string
}

export interface TableDetails {
  columns: ColumnInfo[]
  indexes: IndexInfo[]
  constraints: ConstraintInfo[]
  sizeBytes: number | null
  rowEstimate: number | null
  comment: string | null
}

export interface CompletionColumn {
  name: string
  type: string
}

export interface CompletionTable {
  schema: string
  name: string
  kind: ObjectKind
  columns: CompletionColumn[]
}

export interface CompletionFunction {
  schema: string
  name: string
  args: string
  returns: string
}

export interface CompletionSchema {
  schemas: string[]
  tables: CompletionTable[]
  functions: CompletionFunction[]
}

export interface TableDataRequest {
  schema: string
  table: string
  limit: number
  offset: number
  where?: string
  orderBy?: { column: string; dir: 'asc' | 'desc' } | null
}

export interface RowChange {
  kind: 'update' | 'delete' | 'insert'
  /** valores da PK (para update/delete) */
  key?: Record<string, string | null>
  /** coluna -> novo valor (update/insert) */
  values?: Record<string, string | null>
}

export interface HistoryEntry {
  id: string
  connectionId: string
  connectionName: string
  database: string
  sql: string
  at: number
  durationMs: number
  ok: boolean
  rowCount: number | null
}

export interface ExportRequest {
  format: 'csv' | 'json' | 'sql'
  fields: string[]
  rows: (string | null)[][]
  suggestedName: string
  tableName?: string
}
