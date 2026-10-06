import { contextBridge, ipcRenderer } from 'electron'
import type {
  CompletionSchema,
  ConnectionConfig,
  DbObject,
  ExportRequest,
  ForeignKey,
  HistoryEntry,
  ObjectKind,
  QueryError,
  QueryResult,
  RowChange,
  ServerInfo,
  TableDataRequest,
  TableDetails
} from '../shared/types'

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = await ipcRenderer.invoke(channel, ...args)
  if (!res.ok) throw Object.assign(new Error(res.error.message), { info: res.error })
  return res.data as T
}

export type ConnectionSummary = Omit<ConnectionConfig, 'password'> & { hasPassword: boolean }

export type ExecuteResponse =
  | { ok: true; result: QueryResult; inTransaction: boolean }
  | { ok: false; error: QueryError; inTransaction: boolean }

const api = {
  platform: process.platform,
  connections: {
    list: () => call<ConnectionSummary[]>('connections:list'),
    get: (id: string) => call<ConnectionConfig | null>('connections:get', id),
    save: (conn: ConnectionConfig) => call<string>('connections:save', conn),
    remove: (id: string) => call<void>('connections:delete', id),
    test: (conn: ConnectionConfig) => call<ServerInfo>('connections:test', conn),
    needsPassword: (id: string) => call<boolean>('connections:needsPassword', id)
  },
  db: {
    connect: (id: string, password?: string) => call<ServerInfo>('db:connect', id, password),
    disconnect: (id: string) => call<void>('db:disconnect', id)
  },
  meta: {
    databases: (id: string) => call<string[]>('meta:databases', id),
    schemas: (id: string, database: string) => call<string[]>('meta:schemas', id, database),
    objects: (id: string, database: string, schema: string) =>
      call<DbObject[]>('meta:objects', id, database, schema),
    table: (id: string, database: string, schema: string, table: string) =>
      call<TableDetails>('meta:table', id, database, schema, table),
    ddl: (id: string, database: string, schema: string, name: string, kind: ObjectKind, args?: string) =>
      call<string>('meta:ddl', id, database, schema, name, kind, args),
    completion: (id: string, database: string) => call<CompletionSchema>('meta:completion', id, database),
    foreignKeys: (id: string, database: string, tableOids: number[], direction: 'out' | 'in' = 'out') =>
      call<ForeignKey[]>('meta:foreignKeys', id, database, tableOids, direction)
  },
  query: {
    execute: (sessionId: string, connId: string, database: string, sql: string, maxRows: number) =>
      call<ExecuteResponse>('query:execute', sessionId, connId, database, sql, maxRows),
    cancel: (sessionId: string) => call<boolean>('query:cancel', sessionId),
    closeSession: (sessionId: string) => call<void>('query:closeSession', sessionId)
  },
  table: {
    data: (id: string, database: string, req: TableDataRequest) => call<QueryResult>('table:data', id, database, req),
    count: (id: string, database: string, schema: string, table: string, where?: string, cap?: number) =>
      call<number>('table:count', id, database, schema, table, where, cap),
    apply: (id: string, database: string, schema: string, table: string, changes: RowChange[]) =>
      call<number>('table:apply', id, database, schema, table, changes)
  },
  history: {
    list: () => call<HistoryEntry[]>('history:list'),
    clear: () => call<void>('history:clear')
  },
  exportResult: (req: ExportRequest) => call<string | null>('export:save', req),
  copy: (text: string) => call<void>('clipboard:write', text)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
