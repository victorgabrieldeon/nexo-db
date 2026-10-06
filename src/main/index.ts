import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import * as db from './db'
import * as store from './store'
import { exportResult } from './export'
import type { ConnectionConfig, ExportRequest, HistoryEntry, ObjectKind, RowChange, TableDataRequest } from '../shared/types'

// permite isolar os dados (conexões/histórico) em outro diretório, útil para desenvolvimento e testes
if (process.env.NEXO_USER_DATA) app.setPath('userData', process.env.NEXO_USER_DATA)

let win: BrowserWindow | null = null
let connections: ConnectionConfig[] = []

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0d12',
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? true : { color: '#00000000', symbolColor: '#8b93a7', height: 40 },
    trafficLightPosition: { x: 14, y: 13 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

/** Todo handler responde { ok, data } | { ok: false, error } — o preload converte em exceção limpa. */
function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...(args as A)) }
    } catch (e) {
      return { ok: false, error: db.toQueryError(e) }
    }
  })
}

function persistConnections(list: ConnectionConfig[]): void {
  connections = list
  store.saveConnections(list)
  db.setConfigs(list)
}

function registerIpc(): void {
  handle('connections:list', () => connections.map(({ password, ...c }) => ({ ...c, hasPassword: !!password })))
  handle('connections:get', (id: string) => connections.find((c) => c.id === id) ?? null)
  handle('connections:save', async (conn: ConnectionConfig) => {
    const saved = { ...conn, id: conn.id || randomUUID() }
    const prev = connections.find((c) => c.id === saved.id)
    if (prev) await db.disconnect(saved.id)
    if (!saved.savePassword) delete saved.password
    persistConnections(prev ? connections.map((c) => (c.id === saved.id ? saved : c)) : [...connections, saved])
    return saved.id
  })
  handle('connections:delete', async (id: string) => {
    await db.disconnect(id)
    persistConnections(connections.filter((c) => c.id !== id))
  })
  handle('connections:test', (conn: ConnectionConfig) => db.testConnection(conn))
  handle('connections:needsPassword', (id: string) => db.needsPassword(id))
  handle('db:connect', (id: string, password?: string) => db.connect(id, password))
  handle('db:disconnect', (id: string) => db.disconnect(id))

  handle('meta:databases', (id: string) => db.listDatabases(id))
  handle('meta:schemas', (id: string, database: string) => db.listSchemas(id, database))
  handle('meta:objects', (id: string, database: string, schema: string) => db.listObjects(id, database, schema))
  handle('meta:table', (id: string, database: string, schema: string, table: string) =>
    db.tableDetails(id, database, schema, table)
  )
  handle('meta:ddl', (id: string, database: string, schema: string, name: string, kind: ObjectKind, args?: string) =>
    db.getDdl(id, database, schema, name, kind, args)
  )
  handle('meta:foreignKeys', (id: string, database: string, tableOids: number[], direction?: 'out' | 'in') =>
    db.foreignKeys(id, database, tableOids, direction)
  )
  handle('meta:completion', (id: string, database: string) => db.completionSchema(id, database))

  handle(
    'query:execute',
    async (sessionId: string, connId: string, database: string, sql: string, maxRows: number) => {
      const conn = connections.find((c) => c.id === connId)
      const entry: HistoryEntry = {
        id: randomUUID(),
        connectionId: connId,
        connectionName: conn?.name ?? '',
        database,
        sql,
        at: Date.now(),
        durationMs: 0,
        ok: true,
        rowCount: null
      }
      try {
        const result = await db.executeInSession(sessionId, connId, database, sql, maxRows)
        store.appendHistory({ ...entry, durationMs: result.durationMs, rowCount: result.rowCount ?? result.rows.length })
        return { ok: true, result, inTransaction: db.sessionInTransaction(sessionId) }
      } catch (e) {
        store.appendHistory({ ...entry, ok: false })
        return { ok: false, error: db.toQueryError(e), inTransaction: db.sessionInTransaction(sessionId) }
      }
    }
  )
  handle('query:cancel', (sessionId: string) => db.cancelSession(sessionId))
  handle('query:closeSession', (sessionId: string) => db.closeSession(sessionId))

  handle('table:data', (id: string, database: string, req: TableDataRequest) => db.tableData(id, database, req))
  handle('table:count', (id: string, database: string, schema: string, table: string, where?: string, cap?: number) =>
    db.countRows(id, database, schema, table, where, cap)
  )
  handle('table:apply', (id: string, database: string, schema: string, table: string, changes: RowChange[]) =>
    db.applyChanges(id, database, schema, table, changes)
  )

  handle('history:list', () => store.loadHistory())
  handle('history:clear', () => store.clearHistory())

  handle('export:save', (req: ExportRequest) => (win ? exportResult(win, req) : null))
  handle('clipboard:write', (text: string) => clipboard.writeText(text))
}

app.whenReady().then(() => {
  connections = store.loadConnections()
  db.setConfigs(connections)
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  e.preventDefault()
  quitting = true
  db.disconnectAll().finally(() => app.quit())
})
