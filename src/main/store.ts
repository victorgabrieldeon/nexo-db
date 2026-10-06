import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { join } from 'path'
import type { ConnectionConfig, HistoryEntry } from '../shared/types'

const HISTORY_LIMIT = 500

interface StoredConnection extends Omit<ConnectionConfig, 'password'> {
  /** senha cifrada com safeStorage (base64) ou texto puro quando a criptografia do SO não está disponível */
  password?: string
  passwordEncrypted?: boolean
}

function dataDir(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return dir
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(join(dataDir(), file), 'utf8')) as T
  } catch {
    return fallback
  }
}

/** escrita atômica: grava em arquivo temporário e renomeia */
function writeJson(file: string, data: unknown): void {
  const target = join(dataDir(), file)
  const tmp = `${target}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, target)
}

function encrypt(value: string): { password: string; passwordEncrypted: boolean } {
  if (safeStorage.isEncryptionAvailable()) {
    return { password: safeStorage.encryptString(value).toString('base64'), passwordEncrypted: true }
  }
  return { password: value, passwordEncrypted: false }
}

function decrypt(conn: StoredConnection): string | undefined {
  if (!conn.password) return undefined
  if (!conn.passwordEncrypted) return conn.password
  try {
    return safeStorage.decryptString(Buffer.from(conn.password, 'base64'))
  } catch {
    return undefined
  }
}

export function loadConnections(): ConnectionConfig[] {
  return readJson<StoredConnection[]>('connections.json', []).map((c) => {
    const { passwordEncrypted: _, ...rest } = c
    return { ...rest, password: decrypt(c) }
  })
}

export function saveConnections(list: ConnectionConfig[]): void {
  const stored: StoredConnection[] = list.map((c) => {
    const { password, ...rest } = c
    if (!c.savePassword || !password) return { ...rest }
    return { ...rest, ...encrypt(password) }
  })
  writeJson('connections.json', stored)
}

export function loadHistory(): HistoryEntry[] {
  return readJson<HistoryEntry[]>('history.json', [])
}

export function appendHistory(entry: HistoryEntry): void {
  const list = loadHistory()
  list.unshift(entry)
  writeJson('history.json', list.slice(0, HISTORY_LIMIT))
}

export function clearHistory(): void {
  writeJson('history.json', [])
}
