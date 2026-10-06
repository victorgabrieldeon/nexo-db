import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ObjectKind } from '@shared/types'
import { uid } from '@/lib/utils'

export interface QueryTab {
  id: string
  kind: 'query'
  title: string
  connId: string | null
  database: string | null
  sql: string
}

export type ObjectView = 'data' | 'structure' | 'ddl'

export interface ObjectTab {
  id: string
  kind: 'object'
  title: string
  connId: string
  database: string
  schema: string
  name: string
  objKind: ObjectKind
  args?: string
  view: ObjectView
  /** filtro WHERE aplicado ao abrir (ex.: navegação por FK) */
  filter?: string
  /** muda a cada navegação para reaplicar o filtro mesmo se o texto for igual */
  filterNonce?: number
}

export type Tab = QueryTab | ObjectTab

interface TabsState {
  tabs: Tab[]
  activeId: string | null
  counter: number
  newQuery: (opts?: { connId?: string | null; database?: string | null; sql?: string; title?: string }) => string
  openObject: (o: Omit<ObjectTab, 'id' | 'kind' | 'title' | 'view' | 'filterNonce'> & { view?: ObjectView }) => void
  close: (id: string) => void
  closeOthers: (id: string) => void
  activate: (id: string) => void
  update: (id: string, patch: Partial<QueryTab> | Partial<ObjectTab>) => void
  move: (from: number, to: number) => void
  cycle: (dir: 1 | -1) => void
}

function closeSession(tab: Tab | undefined): void {
  if (tab?.kind === 'query') window.api.query.closeSession(tab.id).catch(() => {})
}

export const useTabs = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeId: null,
      counter: 0,

      newQuery: (opts = {}) => {
        const counter = get().counter + 1
        const tab: QueryTab = {
          id: uid(),
          kind: 'query',
          title: opts.title ?? `Consulta ${counter}`,
          connId: opts.connId ?? null,
          database: opts.database ?? null,
          sql: opts.sql ?? ''
        }
        set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id, counter }))
        return tab.id
      },

      openObject: (o) => {
        const existing = get().tabs.find(
          (t) =>
            t.kind === 'object' &&
            t.connId === o.connId &&
            t.database === o.database &&
            t.schema === o.schema &&
            t.name === o.name &&
            t.args === o.args
        )
        const nonce = o.filter !== undefined ? Date.now() : undefined
        if (existing) {
          set((s) => ({
            activeId: existing.id,
            tabs: s.tabs.map((t) =>
              t.id === existing.id
                ? ({
                    ...t,
                    ...(o.view ? { view: o.view } : {}),
                    ...(o.filter !== undefined ? { filter: o.filter, filterNonce: nonce } : {})
                  } as ObjectTab)
                : t
            )
          }))
          return
        }
        const view: ObjectView = o.view ?? (o.objKind === 'function' || o.objKind === 'sequence' ? 'ddl' : 'data')
        const tab: ObjectTab = { ...o, id: uid(), kind: 'object', title: o.name, view, filterNonce: nonce }
        set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }))
      },

      close: (id) => {
        const { tabs, activeId } = get()
        const idx = tabs.findIndex((t) => t.id === id)
        if (idx === -1) return
        closeSession(tabs[idx])
        const next = tabs.filter((t) => t.id !== id)
        const nextActive = activeId === id ? (next[idx] ?? next[idx - 1] ?? null)?.id ?? null : activeId
        set({ tabs: next, activeId: nextActive })
      },

      closeOthers: (id) => {
        get().tabs.filter((t) => t.id !== id).forEach(closeSession)
        set((s) => ({ tabs: s.tabs.filter((t) => t.id === id), activeId: id }))
      },

      activate: (id) => set({ activeId: id }),

      update: (id, patch) =>
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? ({ ...t, ...patch } as Tab) : t)) })),

      move: (from, to) =>
        set((s) => {
          const tabs = [...s.tabs]
          const [t] = tabs.splice(from, 1)
          tabs.splice(to, 0, t)
          return { tabs }
        }),

      cycle: (dir) => {
        const { tabs, activeId } = get()
        if (!tabs.length) return
        const idx = tabs.findIndex((t) => t.id === activeId)
        set({ activeId: tabs[(idx + dir + tabs.length) % tabs.length].id })
      }
    }),
    { name: 'nexo-tabs', version: 1 }
  )
)
