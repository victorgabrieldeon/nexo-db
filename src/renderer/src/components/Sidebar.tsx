import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ChevronRight,
  Code2,
  Columns3,
  Copy,
  Database,
  Eye,
  FolderTree,
  FunctionSquare,
  History,
  KeyRound,
  Layers,
  ListOrdered,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Table2,
  TerminalSquare,
  Trash2,
  Unplug,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import type { ColumnInfo, DbObject, ObjectKind } from '@shared/types'
import type { ConnectionSummary } from '../../../preload'
import { useConnections } from '@/stores/connections'
import { useTabs } from '@/stores/tabs'
import { useUi } from '@/stores/ui'
import { cn, errorMessage, qualifiedName } from '@/lib/utils'
import { IconButton, Spinner, showContextMenu, type MenuEntry } from './ui'
import { HistoryPanel } from './HistoryPanel'

const FilterContext = createContext('')

export function Sidebar() {
  const view = useUi((s) => s.sidebarView)
  const setView = useUi((s) => s.setSidebarView)
  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
        <SideTab active={view === 'explorer'} onClick={() => setView('explorer')} icon={<FolderTree className="size-3.5" />}>
          Explorador
        </SideTab>
        <SideTab active={view === 'history'} onClick={() => setView('history')} icon={<History className="size-3.5" />}>
          Histórico
        </SideTab>
      </div>
      {view === 'explorer' ? <Explorer /> : <HistoryPanel />}
    </div>
  )
}

function SideTab({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors',
        active ? 'text-fg' : 'text-muted hover:text-fg'
      )}
    >
      {active && (
        <motion.span layoutId="side-tab" className="absolute inset-0 rounded-md bg-elev-2" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
      )}
      <span className="relative flex items-center gap-1.5">
        {icon}
        {children}
      </span>
    </button>
  )
}

function Explorer() {
  const list = useConnections((s) => s.list)
  const openDialog = useConnections((s) => s.openDialog)
  const [filter, setFilter] = useState('')

  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5 px-2 pt-2 pb-1.5">
        <div className="flex h-7 flex-1 items-center gap-2 rounded-lg bg-bg px-2 ring-1 ring-line transition-shadow focus-within:ring-accent">
          <Search className="size-3.5 text-faint" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar objetos"
            className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-faint"
          />
          {filter && (
            <button onClick={() => setFilter('')} className="text-faint hover:text-fg">
              <X className="size-3" />
            </button>
          )}
        </div>
        <IconButton title="Nova conexão" onClick={() => openDialog()}>
          <Plus className="size-4" />
        </IconButton>
      </div>
      <FilterContext.Provider value={filter.toLowerCase()}>
        <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-3">
          {list.map((c) => (
            <ConnectionNode key={c.id} conn={c} />
          ))}
          {!list.length && (
            <div className="mx-2 mt-6 flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong p-6 text-center">
              <Database className="size-6 text-faint" strokeWidth={1.5} />
              <div className="text-[12.5px] text-muted">Nenhuma conexão ainda</div>
              <button onClick={() => openDialog()} className="text-[12.5px] font-medium text-accent hover:underline">
                Adicionar conexão
              </button>
            </div>
          )}
        </div>
      </FilterContext.Provider>
    </>
  )
}

// ───────────────────────────── linha genérica ─────────────────────────────

function TreeRow({
  depth,
  expanded,
  expandable,
  icon,
  label,
  hint,
  loading,
  onToggle,
  onClick,
  onDoubleClick,
  onContextMenu,
  title,
  right
}: {
  depth: number
  expanded?: boolean
  expandable?: boolean
  icon: ReactNode
  label: ReactNode
  hint?: ReactNode
  loading?: boolean
  onToggle?: () => void
  onClick?: () => void
  onDoubleClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  title?: string
  right?: ReactNode
}) {
  return (
    <div
      title={title}
      onClick={onClick ?? onToggle}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className="group flex h-[26px] cursor-default items-center gap-1 rounded-md pr-1.5 text-[12.5px] transition-colors duration-100 hover:bg-hover"
      style={{ paddingLeft: 4 + depth * 14 }}
    >
      <span
        className="flex size-4 shrink-0 items-center justify-center text-faint"
        onClick={(e) => {
          if (expandable && onClick) {
            e.stopPropagation()
            onToggle?.()
          }
        }}
      >
        {loading ? (
          <Spinner className="size-3" />
        ) : (
          expandable && (
            <ChevronRight className={cn('size-3.5 transition-transform duration-200 ease-[var(--ease-smooth)]', expanded && 'rotate-90')} />
          )
        )}
      </span>
      <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-[11px] text-faint">{hint}</span>}
      {right}
    </div>
  )
}

function Children({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** carrega dados de um nó sob demanda, recarregando quando a árvore da conexão é invalidada */
function useLazy<T>(open: boolean, connId: string, fetcher: () => Promise<T>): { data: T | null; loading: boolean; reload: () => void } {
  const version = useConnections((s) => s.treeVersion[connId] ?? 0)
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const key = `${version}:${tick}`

  useEffect(() => {
    if (!open || loadedKey === key) return
    let cancelled = false
    setLoading(true)
    fetcher()
      .then((d) => {
        if (cancelled) return
        setData(d)
        setLoadedKey(key)
      })
      .catch((e) => !cancelled && toast.error('Falha ao carregar', { description: errorMessage(e) }))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key])

  return { data, loading, reload: () => setTick((t) => t + 1) }
}

// ───────────────────────────── conexão ─────────────────────────────

function ConnectionNode({ conn }: { conn: ConnectionSummary }) {
  const status = useConnections((s) => s.status[conn.id] ?? 'idle')
  const server = useConnections((s) => s.server[conn.id])
  const { connect, disconnect, openDialog, remove, refreshTree } = useConnections.getState()
  const newQuery = useTabs((s) => s.newQuery)
  const [open, setOpen] = useState(false)
  const connected = status === 'connected'

  const { data: dbs, loading } = useLazy(open && connected, conn.id, () => window.api.meta.databases(conn.id))

  const toggle = async (): Promise<void> => {
    if (open) return setOpen(false)
    if (!connected && !(await connect(conn.id))) return
    setOpen(true)
  }

  const edit = async (): Promise<void> => {
    const full = await window.api.connections.get(conn.id)
    if (full) openDialog(full)
  }

  const menu = (e: React.MouseEvent): void => {
    const items: MenuEntry[] = [
      connected
        ? { label: 'Desconectar', icon: <Unplug />, onSelect: () => (setOpen(false), void disconnect(conn.id)) }
        : { label: 'Conectar', icon: <Plug />, onSelect: () => void toggle() },
      { label: 'Nova consulta', icon: <TerminalSquare />, shortcut: 'Ctrl+T', onSelect: () => newQuery({ connId: conn.id }) },
      { label: 'Atualizar', icon: <RefreshCw />, disabled: !connected, onSelect: () => refreshTree(conn.id) },
      'separator',
      { label: 'Editar conexão', icon: <Pencil />, onSelect: edit },
      {
        label: 'Duplicar',
        icon: <Copy />,
        onSelect: async () => {
          const full = await window.api.connections.get(conn.id)
          if (full) openDialog({ ...full, id: '', name: `${full.name} (cópia)` })
        }
      },
      'separator',
      {
        label: 'Excluir conexão',
        icon: <Trash2 />,
        danger: true,
        onSelect: async () => {
          if (confirm(`Excluir a conexão "${conn.name}"?`)) await remove(conn.id)
        }
      }
    ]
    showContextMenu(e, items)
  }

  return (
    <div className="mt-0.5">
      <TreeRow
        depth={0}
        expandable
        expanded={open}
        loading={status === 'connecting'}
        onToggle={toggle}
        onContextMenu={menu}
        title={`${conn.user}@${conn.host}:${conn.port}/${conn.database}${server ? `\nPostgreSQL ${server.version}` : ''}`}
        icon={
          <span className="relative flex">
            <Database className="size-3.5" style={{ color: conn.color }} />
            <span
              className={cn(
                'absolute -right-0.5 -bottom-0.5 size-[7px] rounded-full ring-2 ring-panel transition-colors',
                connected ? 'bg-ok' : status === 'error' ? 'bg-err' : 'bg-transparent'
              )}
            />
          </span>
        }
        label={<span className="font-medium">{conn.name}</span>}
        hint={server ? `v${server.version.split(' ')[0]}` : undefined}
        right={
          connected && (
            <IconButton
              size="sm"
              className="opacity-0 group-hover:opacity-100"
              title="Nova consulta"
              onClick={(e) => {
                e.stopPropagation()
                newQuery({ connId: conn.id })
              }}
            >
              <TerminalSquare className="size-3.5" />
            </IconButton>
          )
        }
      />
      <Children open={open && connected}>
        {loading && !dbs && <LoadingRow depth={1} />}
        {dbs?.map((db) => (
          <DatabaseNode key={db} connId={conn.id} database={db} defaultOpen={db === (server?.database ?? conn.database)} />
        ))}
      </Children>
    </div>
  )
}

function LoadingRow({ depth }: { depth: number }) {
  return (
    <div className="flex h-[26px] items-center gap-2 text-[12px] text-faint" style={{ paddingLeft: 24 + depth * 14 }}>
      <Spinner className="size-3" /> carregando…
    </div>
  )
}

// ───────────────────────────── banco ─────────────────────────────

function DatabaseNode({ connId, database, defaultOpen }: { connId: string; database: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const newQuery = useTabs((s) => s.newQuery)
  const { data: schemas, loading, reload } = useLazy(open, connId, () => window.api.meta.schemas(connId, database))

  return (
    <div>
      <TreeRow
        depth={1}
        expandable
        expanded={open}
        loading={loading && !schemas}
        onToggle={() => setOpen(!open)}
        icon={<Database className={cn('size-3.5', defaultOpen ? 'text-accent' : 'text-muted')} />}
        label={database}
        onContextMenu={(e) =>
          showContextMenu(e, [
            { label: 'Nova consulta', icon: <TerminalSquare />, onSelect: () => newQuery({ connId, database }) },
            { label: 'Atualizar', icon: <RefreshCw />, onSelect: reload }
          ])
        }
      />
      <Children open={open && !!schemas}>
        {schemas?.map((s) => (
          <SchemaNode key={s} connId={connId} database={database} schema={s} defaultOpen={s === 'public'} />
        ))}
      </Children>
    </div>
  )
}

// ───────────────────────────── schema ─────────────────────────────

const GROUPS: { kinds: ObjectKind[]; label: string; icon: ReactNode }[] = [
  { kinds: ['table', 'partitioned', 'foreign'], label: 'Tabelas', icon: <Table2 className="size-3.5 text-ok" /> },
  { kinds: ['view'], label: 'Views', icon: <Eye className="size-3.5 text-cyan" /> },
  { kinds: ['matview'], label: 'Views materializadas', icon: <Layers className="size-3.5 text-cyan" /> },
  { kinds: ['function'], label: 'Funções', icon: <FunctionSquare className="size-3.5 text-violet" /> },
  { kinds: ['sequence'], label: 'Sequências', icon: <ListOrdered className="size-3.5 text-muted" /> }
]

function SchemaNode({ connId, database, schema, defaultOpen }: { connId: string; database: string; schema: string; defaultOpen: boolean }) {
  const filter = useContext(FilterContext)
  const [open, setOpen] = useState(defaultOpen)
  const newQuery = useTabs((s) => s.newQuery)
  const { data: objects, loading, reload } = useLazy(open || !!filter, connId, () =>
    window.api.meta.objects(connId, database, schema)
  )
  const filtered = filter ? objects?.filter((o) => o.name.toLowerCase().includes(filter)) : objects
  const isOpen = open || (!!filter && !!filtered?.length)
  if (filter && objects && !filtered?.length) return null

  return (
    <div>
      <TreeRow
        depth={2}
        expandable
        expanded={isOpen}
        loading={loading && !objects}
        onToggle={() => setOpen(!open)}
        icon={<FolderTree className="size-3.5 text-muted" />}
        label={schema}
        onContextMenu={(e) =>
          showContextMenu(e, [
            {
              label: 'Nova consulta',
              icon: <TerminalSquare />,
              onSelect: () => newQuery({ connId, database, sql: schema === 'public' ? '' : `SET search_path TO ${schema}, public;\n\n` })
            },
            { label: 'Atualizar', icon: <RefreshCw />, onSelect: reload }
          ])
        }
      />
      <Children open={isOpen && !!filtered}>
        {GROUPS.map((g) => {
          const items = filtered?.filter((o) => g.kinds.includes(o.kind)) ?? []
          if (!items.length) return null
          return <ObjectGroup key={g.label} {...g} items={items} connId={connId} database={database} schema={schema} forceOpen={!!filter} />
        })}
      </Children>
    </div>
  )
}

function ObjectGroup({
  label,
  icon,
  items,
  connId,
  database,
  schema,
  forceOpen
}: {
  label: string
  icon: ReactNode
  items: DbObject[]
  connId: string
  database: string
  schema: string
  forceOpen: boolean
}) {
  const [open, setOpen] = useState(label === 'Tabelas')
  const isOpen = open || forceOpen
  return (
    <div>
      <TreeRow
        depth={3}
        expandable
        expanded={isOpen}
        onToggle={() => setOpen(!open)}
        icon={icon}
        label={<span className="text-muted">{label}</span>}
        hint={items.length}
      />
      <Children open={isOpen}>
        {items.map((o) => (
          <ObjectNode key={`${o.name}(${o.args ?? ''})`} obj={o} icon={icon} connId={connId} database={database} schema={schema} />
        ))}
      </Children>
    </div>
  )
}

function ObjectNode({ obj, icon, connId, database, schema }: { obj: DbObject; icon: ReactNode; connId: string; database: string; schema: string }) {
  const openObject = useTabs((s) => s.openObject)
  const newQuery = useTabs((s) => s.newQuery)
  const [open, setOpen] = useState(false)
  const hasColumns = obj.kind !== 'function' && obj.kind !== 'sequence'
  const fetchColumns = useCallback(
    () => window.api.meta.table(connId, database, schema, obj.name).then((d) => d.columns),
    [connId, database, schema, obj.name]
  )
  const { data: columns, loading } = useLazy<ColumnInfo[]>(open, connId, fetchColumns)
  const fq = qualifiedName(schema, obj.name)

  const openTab = (view?: 'data' | 'structure' | 'ddl'): void =>
    openObject({ connId, database, schema, name: obj.name, objKind: obj.kind, args: obj.args, view })

  const menu = (e: React.MouseEvent): void => {
    const items: MenuEntry[] = hasColumns
      ? [
          { label: 'Abrir dados', icon: <Table2 />, onSelect: () => openTab('data') },
          { label: 'Estrutura', icon: <Columns3 />, onSelect: () => openTab('structure') },
          { label: 'DDL', icon: <Code2 />, onSelect: () => openTab('ddl') },
          'separator',
          {
            label: 'SELECT em nova consulta',
            icon: <TerminalSquare />,
            onSelect: () => newQuery({ connId, database, sql: `SELECT *\nFROM ${fq}\nLIMIT 100;` })
          },
          {
            label: 'Copiar nome',
            icon: <Copy />,
            onSelect: () => {
              window.api.copy(fq)
              toast.success('Nome copiado')
            }
          }
        ]
      : [
          { label: 'Ver definição', icon: <Code2 />, onSelect: () => openTab('ddl') },
          {
            label: 'Copiar nome',
            icon: <Copy />,
            onSelect: () => {
              window.api.copy(obj.kind === 'function' ? `${fq}(${obj.args ?? ''})` : fq)
              toast.success('Nome copiado')
            }
          }
        ]
    showContextMenu(e, items)
  }

  return (
    <div>
      <TreeRow
        depth={4}
        expandable={hasColumns}
        expanded={open}
        loading={loading && !columns}
        onToggle={() => setOpen(!open)}
        onClick={() => openTab()}
        onContextMenu={menu}
        icon={icon}
        label={
          <>
            {obj.name}
            {obj.kind === 'function' && <span className="text-faint">({obj.args})</span>}
          </>
        }
        title={obj.comment ?? undefined}
      />
      <Children open={open && !!columns}>
        {columns?.map((c) => (
          <div
            key={c.name}
            className="flex h-[24px] items-center gap-1.5 rounded-md pr-2 text-[12px] hover:bg-hover"
            style={{ paddingLeft: 4 + 5 * 14 + 20 }}
            title={c.comment ?? undefined}
          >
            {c.isPrimaryKey ? <KeyRound className="size-3 shrink-0 text-warn" /> : <Columns3 className="size-3 shrink-0 text-faint" />}
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            <span className="shrink-0 truncate font-mono text-[10.5px] text-faint">{c.type}</span>
          </div>
        ))}
      </Children>
    </div>
  )
}
