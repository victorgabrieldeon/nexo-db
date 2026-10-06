import { motion } from 'motion/react'
import { Database, Plus, Table2, TerminalSquare, X, Eye, FunctionSquare, Layers, ListOrdered, Command as CommandIcon } from 'lucide-react'
import { useTabs, type Tab } from '@/stores/tabs'
import { defaultConnId, useConnections } from '@/stores/connections'
import { useUi } from '@/stores/ui'
import { cn, modKey } from '@/lib/utils'
import { QueryTab } from './QueryTab'
import { ErrorBoundary } from './ErrorBoundary'
import { ObjectTab } from './ObjectTab'
import { IconButton, Kbd, showContextMenu } from './ui'

function tabIcon(t: Tab) {
  if (t.kind === 'query') return <TerminalSquare className="size-3.5 text-accent" />
  switch (t.objKind) {
    case 'view':
      return <Eye className="size-3.5 text-cyan" />
    case 'matview':
      return <Layers className="size-3.5 text-cyan" />
    case 'function':
      return <FunctionSquare className="size-3.5 text-violet" />
    case 'sequence':
      return <ListOrdered className="size-3.5 text-muted" />
    default:
      return <Table2 className="size-3.5 text-ok" />
  }
}

export function TabBar() {
  const tabs = useTabs((s) => s.tabs)
  const activeId = useTabs((s) => s.activeId)
  const { activate, close, closeOthers, newQuery, update } = useTabs.getState()
  const list = useConnections((s) => s.list)

  const activeConn = tabs.find((t) => t.id === activeId)?.connId ?? null

  return (
    <div className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-line bg-panel px-1.5 [&::-webkit-scrollbar]:h-0">
      {tabs.map((t) => {
        const active = t.id === activeId
        const conn = list.find((c) => c.id === t.connId)
        return (
          <div
            key={t.id}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault()
                close(t.id)
              } else if (e.button === 0) activate(t.id)
            }}
            onDoubleClick={() => {
              if (t.kind !== 'query') return
              const title = prompt('Renomear aba', t.title)
              if (title?.trim()) update(t.id, { title: title.trim() })
            }}
            onContextMenu={(e) =>
              showContextMenu(e, [
                { label: 'Fechar', icon: <X />, shortcut: `${modKey}+W`, onSelect: () => close(t.id) },
                { label: 'Fechar outras', onSelect: () => closeOthers(t.id) }
              ])
            }
            className={cn(
              'group relative flex h-[30px] max-w-[220px] min-w-[120px] shrink-0 cursor-default items-center gap-2 rounded-t-lg pr-1.5 pl-3 text-[12.5px] transition-colors',
              active ? 'text-fg' : 'text-muted hover:bg-white/[0.025] hover:text-fg'
            )}
          >
            {active && (
              <motion.div
                layoutId="tab-active"
                className="absolute inset-0 rounded-t-lg border border-b-0 border-line-strong bg-bg"
                transition={{ type: 'spring', stiffness: 520, damping: 40 }}
              >
                <div className="absolute inset-x-3 top-0 h-[2px] rounded-b-full" style={{ background: conn?.color ?? 'var(--color-accent)' }} />
              </motion.div>
            )}
            <span className="relative flex min-w-0 flex-1 items-center gap-2">
              {tabIcon(t)}
              <span className="truncate">{t.title}</span>
            </span>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => close(t.id)}
              className={cn(
                'relative flex size-5 shrink-0 items-center justify-center rounded text-faint transition-all hover:bg-hover hover:text-fg',
                active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              )}
            >
              <X className="size-3" />
            </button>
          </div>
        )
      })}
      <IconButton className="mb-[3px] ml-1" title={`Nova consulta (${modKey}+T)`} onClick={() => newQuery({ connId: defaultConnId(activeConn) })}>
        <Plus className="size-4" />
      </IconButton>
    </div>
  )
}

export function Workspace() {
  const tabs = useTabs((s) => s.tabs)
  const activeId = useTabs((s) => s.activeId)

  if (!tabs.length) return <Welcome />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TabBar />
      <div className="relative min-h-0 flex-1">
        {tabs.map((t) => (
          <div key={t.id} className={cn('absolute inset-0', t.id !== activeId && 'invisible')}>
            <ErrorBoundary label={t.title}>
              {t.kind === 'query' ? <QueryTab tab={t} active={t.id === activeId} /> : <ObjectTab tab={t} active={t.id === activeId} />}
            </ErrorBoundary>
          </div>
        ))}
      </div>
    </div>
  )
}

function Welcome() {
  const list = useConnections((s) => s.list)
  const status = useConnections((s) => s.status)
  const { openDialog, connect } = useConnections.getState()
  const newQuery = useTabs((s) => s.newQuery)
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden">
      <div className="pointer-events-none absolute top-[-20%] left-1/2 h-[520px] w-[720px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,#6d8cff22,transparent)] blur-2xl" />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-[520px]"
      >
        <div className="mb-8 flex items-center gap-3.5">
          <Logo size={44} />
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Nexo DB</h1>
            <p className="text-[13px] text-muted">Cliente PostgreSQL rápido e direto ao ponto</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <ActionCard icon={<Plus className="size-4" />} title="Nova conexão" desc="Host, URL postgres:// ou local" onClick={() => openDialog()} />
          <ActionCard
            icon={<TerminalSquare className="size-4" />}
            title="Nova consulta"
            desc="Editor SQL com autocomplete"
            onClick={() => newQuery({ connId: list.find((c) => status[c.id] === 'connected')?.id ?? list[0]?.id ?? null })}
          />
        </div>

        {list.length > 0 && (
          <div className="mt-7">
            <h2 className="mb-2 text-[11px] font-semibold tracking-wider text-faint uppercase">Conexões</h2>
            <div className="overflow-hidden rounded-xl border border-line bg-panel/60">
              {list.slice(0, 6).map((c) => (
                <button
                  key={c.id}
                  onClick={async () => {
                    if (await connect(c.id)) newQuery({ connId: c.id })
                  }}
                  className="flex h-11 w-full items-center gap-3 border-t border-line px-3.5 text-left transition-colors first:border-t-0 hover:bg-hover"
                >
                  <Database className="size-4" style={{ color: c.color }} />
                  <span className="flex-1 truncate text-[13px] font-medium">{c.name}</span>
                  <span className="truncate font-mono text-[11.5px] text-faint">
                    {c.user}@{c.host}:{c.port}/{c.database}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-muted">
          <button className="flex items-center gap-1.5 hover:text-fg" onClick={() => setPaletteOpen(true)}>
            <CommandIcon className="size-3.5" /> Buscar tudo <Kbd>{modKey}</Kbd>
            <Kbd>K</Kbd>
          </button>
          <span className="flex items-center gap-1.5">
            Executar <Kbd>{modKey}</Kbd>
            <Kbd>Enter</Kbd>
          </span>
          <span className="flex items-center gap-1.5">
            Barra lateral <Kbd>{modKey}</Kbd>
            <Kbd>B</Kbd>
          </span>
        </div>
      </motion.div>
    </div>
  )
}

function ActionCard({ icon, title, desc, onClick }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      onClick={onClick}
      className="group flex flex-col items-start gap-3 rounded-xl border border-line bg-panel/70 p-4 text-left transition-colors hover:border-line-strong hover:bg-elev"
    >
      <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent transition-colors group-hover:bg-accent group-hover:text-white">
        {icon}
      </span>
      <span>
        <span className="block text-[13.5px] font-medium">{title}</span>
        <span className="block text-[12px] text-muted">{desc}</span>
      </span>
    </motion.button>
  )
}

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <defs>
        <linearGradient id="nexo-g" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8da4ff" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#nexo-g)" />
      <path d="M10 22V10l12 12V10" stroke="#0b0d12" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
