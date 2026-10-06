import { create } from 'zustand'
import { toast } from 'sonner'
import type { CompletionSchema, ConnectionConfig, ServerInfo } from '@shared/types'
import type { ConnectionSummary } from '../../../preload'
import { errorMessage } from '@/lib/utils'

export type ConnStatus = 'idle' | 'connecting' | 'connected' | 'error'

interface PasswordPrompt {
  connection: ConnectionSummary
  resolve: (password: string | null) => void
}

interface ConnectionsState {
  list: ConnectionSummary[]
  status: Record<string, ConnStatus>
  server: Record<string, ServerInfo>
  completion: Record<string, CompletionSchema>
  /** incrementado para forçar recarga da árvore de uma conexão */
  treeVersion: Record<string, number>
  dialog: { editing: ConnectionConfig | null } | null
  passwordPrompt: PasswordPrompt | null

  load: () => Promise<void>
  openDialog: (editing?: ConnectionConfig | null) => void
  closeDialog: () => void
  save: (conn: ConnectionConfig) => Promise<string>
  remove: (id: string) => Promise<void>
  connect: (id: string) => Promise<boolean>
  ensureConnected: (id: string) => Promise<boolean>
  disconnect: (id: string) => Promise<void>
  loadCompletion: (id: string, database: string, force?: boolean) => Promise<void>
  refreshTree: (id: string) => void
}

export const completionKey = (id: string, db: string): string => `${id}|${db}`

/** conexão padrão para uma nova consulta: a da aba atual, senão a primeira conectada */
export function defaultConnId(fromTab?: string | null): string | null {
  if (fromTab) return fromTab
  const { list, status } = useConnections.getState()
  return list.find((c) => status[c.id] === 'connected')?.id ?? null
}

const inflightCompletion = new Map<string, Promise<void>>()

export const useConnections = create<ConnectionsState>((set, get) => ({
  list: [],
  status: {},
  server: {},
  completion: {},
  treeVersion: {},
  dialog: null,
  passwordPrompt: null,

  load: async () => {
    set({ list: await window.api.connections.list() })
  },

  openDialog: (editing = null) => set({ dialog: { editing } }),
  closeDialog: () => set({ dialog: null }),

  save: async (conn) => {
    const id = await window.api.connections.save(conn)
    set((s) => ({ status: { ...s.status, [id]: 'idle' } }))
    await get().load()
    return id
  },

  remove: async (id) => {
    await window.api.connections.remove(id)
    await get().load()
  },

  connect: async (id) => {
    const conn = get().list.find((c) => c.id === id)
    if (!conn) return false
    let password: string | undefined
    if (await window.api.connections.needsPassword(id)) {
      const typed = await new Promise<string | null>((resolve) => set({ passwordPrompt: { connection: conn, resolve } }))
      set({ passwordPrompt: null })
      if (typed === null) return false
      password = typed
    }
    set((s) => ({ status: { ...s.status, [id]: 'connecting' } }))
    try {
      const info = await window.api.db.connect(id, password)
      set((s) => ({ status: { ...s.status, [id]: 'connected' }, server: { ...s.server, [id]: info } }))
      return true
    } catch (e) {
      set((s) => ({ status: { ...s.status, [id]: 'error' } }))
      toast.error(`Falha ao conectar em ${conn.name}`, { description: errorMessage(e) })
      return false
    }
  },

  ensureConnected: async (id) => {
    const st = get().status[id]
    if (st === 'connected') return true
    if (st === 'connecting') {
      // espera a conexão em andamento terminar
      return new Promise((resolve) => {
        const unsub = useConnections.subscribe((s) => {
          if (s.status[id] !== 'connecting') {
            unsub()
            resolve(s.status[id] === 'connected')
          }
        })
      })
    }
    return get().connect(id)
  },

  disconnect: async (id) => {
    await window.api.db.disconnect(id)
    set((s) => {
      const completion = Object.fromEntries(Object.entries(s.completion).filter(([k]) => !k.startsWith(`${id}|`)))
      return { status: { ...s.status, [id]: 'idle' }, completion }
    })
  },

  loadCompletion: async (id, database, force = false) => {
    const key = completionKey(id, database)
    if (!force && get().completion[key]) return
    const running = inflightCompletion.get(key)
    if (running) return running
    const p = window.api.meta
      .completion(id, database)
      .then((schema) => set((s) => ({ completion: { ...s.completion, [key]: schema } })))
      .catch(() => {})
      .finally(() => inflightCompletion.delete(key))
    inflightCompletion.set(key, p)
    return p
  },

  refreshTree: (id) => set((s) => ({ treeVersion: { ...s.treeVersion, [id]: (s.treeVersion[id] ?? 0) + 1 } }))
}))
