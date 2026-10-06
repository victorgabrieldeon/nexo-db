import { Command } from 'cmdk'
import { AnimatePresence, motion } from 'motion/react'
import { Database, Eye, History, Layers, PanelLeft, Plug, Plus, Table2, TerminalSquare } from 'lucide-react'
import { useMemo } from 'react'
import { useUi } from '@/stores/ui'
import { useTabs } from '@/stores/tabs'
import { defaultConnId, useConnections } from '@/stores/connections'
import { Kbd } from './ui'
import { modKey } from '@/lib/utils'

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen)
  const setOpen = useUi((s) => s.setPaletteOpen)
  const { toggleSidebar, setSidebarView } = useUi.getState()
  const newQuery = useTabs((s) => s.newQuery)
  const openObject = useTabs((s) => s.openObject)
  const tabs = useTabs((s) => s.tabs)
  const activeId = useTabs((s) => s.activeId)
  const list = useConnections((s) => s.list)
  const status = useConnections((s) => s.status)
  const completion = useConnections((s) => s.completion)
  const { connect, openDialog, loadCompletion } = useConnections.getState()

  const activeTab = tabs.find((t) => t.id === activeId)
  const activeConn = activeTab?.connId ?? list.find((c) => status[c.id] === 'connected')?.id ?? null

  const objects = useMemo(
    () =>
      Object.entries(completion).flatMap(([key, schema]) => {
        const [connId, database] = key.split('|')
        const conn = list.find((c) => c.id === connId)
        return schema.tables.map((t) => ({ connId, database, conn: conn?.name ?? '', ...t }))
      }),
    [completion, list]
  )

  const run = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex justify-center pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onMouseDown={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -4 }}
            transition={{ type: 'spring', stiffness: 480, damping: 34 }}
            className="relative h-fit w-[620px] overflow-hidden rounded-2xl border border-line-strong bg-[#12151cf5] shadow-[0_30px_80px_-20px_#000000e0] backdrop-blur-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Command
              loop
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false)
              }}
              onFocus={() => {
                // garante metadados das conexões abertas para buscar tabelas
                for (const c of list) {
                  if (status[c.id] === 'connected') {
                    const db = useConnections.getState().server[c.id]?.database
                    if (db) void loadCompletion(c.id, db)
                  }
                }
              }}
            >
              <Command.Input
                autoFocus
                placeholder="Buscar tabelas, conexões e comandos…"
                className="h-13 w-full border-b border-line bg-transparent px-4 text-[14px] outline-none placeholder:text-faint"
              />
              <Command.List className="max-h-[400px] overflow-auto p-1.5">
                <Command.Empty className="py-8 text-center text-[12.5px] text-faint">Nada encontrado</Command.Empty>

                <Command.Group heading="Ações">
                  <Item icon={<TerminalSquare />} onSelect={run(() => newQuery({ connId: defaultConnId(activeConn) }))} shortcut={`${modKey} T`}>
                    Nova consulta
                  </Item>
                  <Item icon={<Plus />} onSelect={run(() => openDialog())}>
                    Nova conexão
                  </Item>
                  <Item icon={<PanelLeft />} onSelect={run(toggleSidebar)} shortcut={`${modKey} B`}>
                    Alternar barra lateral
                  </Item>
                  <Item icon={<History />} onSelect={run(() => setSidebarView('history'))}>
                    Histórico de consultas
                  </Item>
                </Command.Group>

                {list.length > 0 && (
                  <Command.Group heading="Conexões">
                    {list.map((c) => (
                      <Item
                        key={c.id}
                        value={`conexão ${c.name} ${c.host}`}
                        icon={status[c.id] === 'connected' ? <Database style={{ color: c.color }} /> : <Plug style={{ color: c.color }} />}
                        onSelect={run(async () => {
                          if (await connect(c.id)) newQuery({ connId: c.id })
                        })}
                        hint={status[c.id] === 'connected' ? 'conectado' : c.host}
                      >
                        {c.name}
                      </Item>
                    ))}
                  </Command.Group>
                )}

                {objects.length > 0 && (
                  <Command.Group heading="Tabelas e views">
                    {objects.slice(0, 2000).map((o) => (
                      <Item
                        key={`${o.connId}|${o.database}|${o.schema}.${o.name}`}
                        value={`${o.schema}.${o.name} ${o.conn} ${o.database}`}
                        icon={o.kind === 'view' ? <Eye /> : o.kind === 'matview' ? <Layers /> : <Table2 />}
                        hint={`${o.conn} · ${o.database}.${o.schema}`}
                        onSelect={run(() =>
                          openObject({ connId: o.connId, database: o.database, schema: o.schema, name: o.name, objKind: o.kind })
                        )}
                      >
                        {o.name}
                      </Item>
                    ))}
                  </Command.Group>
                )}
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Item({
  children,
  icon,
  onSelect,
  shortcut,
  hint,
  value
}: {
  children: React.ReactNode
  icon: React.ReactNode
  onSelect: () => void
  shortcut?: string
  hint?: string
  value?: string
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex h-9 cursor-default items-center gap-3 rounded-lg px-2.5 text-[13px] text-fg transition-colors"
    >
      <span className="flex size-4 items-center justify-center text-muted [&>svg]:size-4">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="truncate text-[11.5px] text-faint">{hint}</span>}
      {shortcut && (
        <span className="flex gap-1">
          {shortcut.split(' ').map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </span>
      )}
    </Command.Item>
  )
}
