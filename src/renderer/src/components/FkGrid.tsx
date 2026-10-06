import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { ArrowDown10, ArrowDownAZ, ChevronRight, CornerLeftDown, CornerRightDown, ExternalLink, Link2, ListFilter, Rows3, Search, SquareStack, Table2, X } from 'lucide-react'
import type { QueryResult } from '@shared/types'
import { useTabs } from '@/stores/tabs'
import { fkLabel, fkTarget, useForeignKeys, type FkMaps, type FkTarget } from '@/lib/fk'
import { cn, errorMessage, formatCount } from '@/lib/utils'
import { isJsonType } from '@/lib/pgTypes'
import { DataGrid, type DataGridProps } from './DataGrid'
import { IconButton, Spinner, showContextMenu } from './ui'

type Cell = string | null
type Anchor = { clientX: number; clientY: number }
type Navigate = (mode: 'open' | 'peek', dir: 'out' | 'in', col: number, row: Cell[], anchor: Anchor) => void

/**
 * Um nível do painel inferior:
 * 'record' segue uma FK até o registro referenciado;
 * 'refs' lista as linhas de outras tabelas que apontam para o registro (uma aba por FK).
 */
type PeekEntry = { kind: 'record'; label: string; target: FkTarget } | { kind: 'refs'; label: string; targets: FkTarget[] }

type Props = DataGridProps & { connId: string | null; database: string | null }

function useFkColumns(connId: string | null, database: string | null, fields: DataGridProps['fields']) {
  const maps = useForeignKeys(connId, database, fields)
  const fkColumns = useMemo(() => new Map([...maps.out].map(([c, ref]) => [c, fkLabel(ref)])), [maps])
  const refColumns = useMemo(() => new Map([...maps.in].map(([c, refs]) => [c, refs.map(fkLabel)])), [maps])
  return { maps, fkColumns, refColumns }
}

/** DataGrid com navegação por FK nas duas direções, abrindo em aba (Ctrl+clique) ou num painel abaixo. */
export function FkGrid({ connId, database, ...grid }: Props) {
  const { maps, fkColumns, refColumns } = useFkColumns(connId, database, grid.fields)
  const openObject = useTabs((s) => s.openObject)
  const [stack, setStack] = useState<PeekEntry[]>([])
  const bottom = usePanelRef()

  const open = useCallback(
    (t: FkTarget) => {
      if (!connId || !database) return
      openObject({ connId, database, schema: t.schema, name: t.table, objKind: 'table', view: 'data', filter: t.where })
    },
    [connId, database, openObject]
  )

  /** `fromLevel`: nível da pilha de onde veio a navegação (-1 = grid principal) */
  const navigate = (maps: FkMaps, fromLevel: number): Navigate => (mode, dir, col, row, anchor) => {
    const push = (entry: PeekEntry): void => setStack((s) => [...s.slice(0, fromLevel + 1), entry])

    if (dir === 'out') {
      const ref = maps.out.get(col)
      const target = ref && fkTarget(ref, row)
      if (!target) return
      if (mode === 'open') open(target)
      else push({ kind: 'record', label: target.label, target })
      return
    }

    const refs = maps.in.get(col) ?? []
    const targets = refs.map((r) => fkTarget(r, row)).filter((t): t is FkTarget => !!t)
    if (!targets.length) return
    if (mode === 'open') {
      if (targets.length === 1) return open(targets[0])
      // várias tabelas apontam para cá: deixa escolher qual abrir
      showContextMenu(
        { ...anchor, preventDefault: () => {} },
        targets.map((t, i) => ({ label: `Abrir ${fkLabel(refs[i])}`, icon: <ExternalLink />, onSelect: () => open(t) }))
      )
      return
    }
    const first = refs[0]
    const values = first.positions.map((p) => row[p]).join(', ')
    push({ kind: 'refs', label: `← ${first.fk.refTable} · ${first.fk.refColumns.join(', ')} = ${values}`, targets })
  }

  useEffect(() => {
    const p = bottom.current
    if (!p) return
    if (stack.length && p.isCollapsed()) p.resize('50%')
    if (!stack.length && !p.isCollapsed()) p.collapse()
  }, [stack.length, bottom])

  return (
    <Group orientation="vertical" className="h-full min-h-0">
      <Panel minSize="20%">
        <DataGrid {...grid} fkColumns={fkColumns} refColumns={refColumns} onFkNavigate={navigate(maps, -1)} />
      </Panel>
      <Separator disabled={!stack.length} className={cn(!stack.length && 'opacity-0')} />
      <Panel
        panelRef={bottom}
        defaultSize={0}
        minSize="15%"
        collapsible
        collapsedSize={0}
        onResize={(size) => {
          // arrastou até fechar: limpa a pilha
          if (size.inPixels === 0 && stack.length) setStack([])
        }}
      >
        {stack.length > 0 && connId && database && (
          <PeekPanel
            connId={connId}
            database={database}
            stack={stack}
            onLevel={(i) => setStack((s) => s.slice(0, i + 1))}
            onClose={() => setStack([])}
            onOpen={open}
            makeNavigate={(m) => navigate(m, stack.length - 1)}
          />
        )}
      </Panel>
    </Group>
  )
}

function PeekPanel({
  connId,
  database,
  stack,
  onLevel,
  onClose,
  onOpen,
  makeNavigate
}: {
  connId: string
  database: string
  stack: PeekEntry[]
  onLevel: (i: number) => void
  onClose: () => void
  onOpen: (t: FkTarget) => void
  makeNavigate: (maps: FkMaps) => Navigate
}) {
  const current = stack[stack.length - 1]
  const targets = current.kind === 'record' ? [current.target] : current.targets
  const [active, setActive] = useState(0)
  const [picked, setPicked] = useState(false)
  const [counts, setCounts] = useState<(number | null)[]>([])
  const [mode, setMode] = useState<'record' | 'grid' | null>(null)
  const target = targets[Math.min(active, targets.length - 1)]
  const key = targets.map((t) => `${t.schema}.${t.table}|${t.where}`).join('||')

  useEffect(() => {
    setActive(0)
    setPicked(false)
    setMode(null)
    if (current.kind !== 'refs') return setCounts([])
    // contagem por tabela, poucas por vez e com teto, para não pesar com dezenas de tabelas grandes
    setCounts(targets.map(() => null))
    let cancelled = false
    let next = 0
    const worker = async (): Promise<void> => {
      while (!cancelled && next < targets.length) {
        const i = next++
        const t = targets[i]
        const n = await window.api.table.count(connId, database, t.schema, t.table, t.where, COUNT_CAP + 1).catch(() => -1)
        if (!cancelled) setCounts((c) => c.map((x, j) => (j === i ? n : x)))
      }
    }
    for (let k = 0; k < 4; k++) void worker()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // quando as contagens chegam, abre na primeira tabela (em ordem alfabética) que tem registros
  useEffect(() => {
    if (picked || counts.length !== targets.length || counts.some((c) => c == null)) return
    if ((counts[active] ?? 0) > 0) return
    const order = targets.map((_, i) => i).sort((a, b) => targetName(targets[a]).localeCompare(targetName(targets[b])))
    const first = order.find((i) => (counts[i] ?? 0) > 0)
    if (first !== undefined) setActive(first)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts, picked])

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line pr-1.5 pl-3">
        {current.kind === 'record' ? (
          <CornerRightDown className="size-3.5 shrink-0 text-violet" />
        ) : (
          <CornerLeftDown className="size-3.5 shrink-0 text-cyan" />
        )}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-[12px] [&::-webkit-scrollbar]:h-0">
          {stack.map((e, i) => (
            <span key={i} className="flex shrink-0 items-center gap-1">
              {i > 0 && <ChevronRight className="size-3 text-faint" />}
              <button
                onClick={() => onLevel(i)}
                className={cn(
                  'rounded px-1.5 py-0.5 font-mono transition-colors',
                  i === stack.length - 1
                    ? e.kind === 'record'
                      ? 'bg-violet/15 text-fg'
                      : 'bg-cyan/15 text-fg'
                    : 'text-muted hover:bg-hover hover:text-fg'
                )}
              >
                {e.label}
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center rounded-md bg-bg p-0.5 ring-1 ring-line">
          <IconButton size="sm" active={mode === 'record'} title="Ficha (um registro por vez)" onClick={() => setMode('record')}>
            <SquareStack className="size-3.5" />
          </IconButton>
          <IconButton size="sm" active={mode === 'grid'} title="Grade" onClick={() => setMode('grid')}>
            <Rows3 className="size-3.5" />
          </IconButton>
        </div>
        <IconButton title="Abrir na aba da tabela" onClick={() => onOpen(target)}>
          <ExternalLink className="size-3.5" />
        </IconButton>
        <IconButton title="Fechar" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1">
        {current.kind === 'refs' && targets.length > 1 && (
          <RefsList
            targets={targets}
            counts={counts}
            active={active}
            onSelect={(i) => {
              setActive(i)
              setPicked(true)
            }}
          />
        )}
        <div className="relative min-h-0 min-w-0 flex-1">
          <PeekContent
            key={`${target.schema}.${target.table}|${target.where}`}
            connId={connId}
            database={database}
            target={target}
            mode={mode}
            emptyText={current.kind === 'record' ? 'Nenhum registro encontrado (referência órfã)' : 'Nenhum registro referencia este'}
            makeNavigate={makeNavigate}
          />
        </div>
      </div>
    </div>
  )
}

const COUNT_CAP = 1000

function targetName(t: FkTarget): string {
  return t.schema === 'public' ? t.table : `${t.schema}.${t.table}`
}

function formatRefCount(n: number | null | undefined): string {
  if (n == null) return '…'
  if (n < 0) return '?'
  return n > COUNT_CAP ? `${formatCount(COUNT_CAP)}+` : formatCount(n)
}

type RefsSort = 'az' | 'count'

function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}

function Highlight({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q) : -1
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-cyan/25 text-fg">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

/** Lista lateral das tabelas que referenciam o registro: busca, ordenação e filtro de vazias. */
function RefsList({
  targets,
  counts,
  active,
  onSelect
}: {
  targets: FkTarget[]
  counts: (number | null)[]
  active: number
  onSelect: (i: number) => void
}) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<RefsSort>(() => loadPref('nexo-refs-sort', 'az'))
  const [onlyWithRows, setOnlyWithRows] = useState<boolean>(() => loadPref('nexo-refs-only-rows', false))
  const term = q.trim().toLowerCase()

  useEffect(() => localStorage.setItem('nexo-refs-sort', JSON.stringify(sort)), [sort])
  useEffect(() => localStorage.setItem('nexo-refs-only-rows', JSON.stringify(onlyWithRows)), [onlyWithRows])

  // nomes repetidos (mesma tabela com mais de uma FK para cá) mostram a coluna para diferenciar
  const dupNames = useMemo(() => {
    const seen = new Map<string, number>()
    for (const t of targets) seen.set(targetName(t), (seen.get(targetName(t)) ?? 0) + 1)
    return seen
  }, [targets])

  const visible = useMemo(() => {
    const idx = targets
      .map((_, i) => i)
      .filter((i) => !term || targetName(targets[i]).toLowerCase().includes(term) || targets[i].via.toLowerCase().includes(term))
      .filter((i) => !onlyWithRows || counts[i] == null || counts[i] !== 0)
    const byName = (a: number, b: number): number =>
      targetName(targets[a]).localeCompare(targetName(targets[b])) || targets[a].via.localeCompare(targets[b].via)
    return idx.sort(sort === 'az' ? byName : (a, b) => (counts[b] ?? -1) - (counts[a] ?? -1) || byName(a, b))
  }, [targets, counts, term, onlyWithRows, sort])

  const loaded = counts.filter((c) => c != null).length
  const withRows = counts.filter((c) => (c ?? 0) > 0).length
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, visible])

  const move = (delta: number): void => {
    if (!visible.length) return
    const pos = visible.indexOf(active)
    const next = visible[Math.max(0, Math.min(visible.length - 1, pos < 0 ? 0 : pos + delta))]
    onSelect(next)
  }

  return (
    <div className="flex w-[260px] shrink-0 flex-col border-r border-line bg-bg/40">
      <div className="space-y-1.5 border-b border-line p-2">
        <div className="flex h-7 items-center gap-2 rounded-lg bg-bg px-2 ring-1 ring-line transition-shadow focus-within:ring-cyan/60">
          <Search className="size-3.5 shrink-0 text-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                move(1)
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                move(-1)
              } else if (e.key === 'Enter' && visible.length && !visible.includes(active)) {
                onSelect(visible[0])
              } else if (e.key === 'Escape' && q) {
                e.stopPropagation()
                setQ('')
              }
            }}
            placeholder={`Buscar em ${targets.length} tabelas…`}
            className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-faint"
          />
          {q && (
            <button onClick={() => setQ('')} className="text-faint hover:text-fg">
              <X className="size-3" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 text-[11px]">
          <div className="flex items-center rounded-md bg-bg p-0.5 ring-1 ring-line">
            {(
              [
                ['az', 'A–Z', <ArrowDownAZ key="i" className="size-3" />],
                ['count', 'Qtd', <ArrowDown10 key="i" className="size-3" />]
              ] as const
            ).map(([v, label, icon]) => (
              <button
                key={v}
                onClick={() => setSort(v)}
                className={cn(
                  'flex h-5 items-center gap-1 rounded px-1.5 transition-colors',
                  sort === v ? 'bg-elev-2 text-fg' : 'text-muted hover:text-fg'
                )}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setOnlyWithRows((v) => !v)}
            title="Esconder tabelas sem registros"
            className={cn(
              'flex h-6 items-center gap-1 rounded-md px-1.5 ring-1 transition-colors',
              onlyWithRows ? 'bg-cyan/15 text-cyan ring-cyan/30' : 'text-muted ring-line hover:text-fg'
            )}
          >
            <ListFilter className="size-3" /> Com registros
          </button>
          <span className="ml-auto text-faint tabular-nums" title="tabelas com registros / total">
            {loaded < targets.length ? <Spinner className="size-3" /> : `${withRows}/${targets.length}`}
          </span>
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-auto p-1">
        {!visible.length && (
          <div className="px-2 py-6 text-center text-[12px] text-faint">
            {term ? 'Nenhuma tabela encontrada' : 'Nenhuma tabela com registros'}
          </div>
        )}
        {visible.map((i) => {
          const t = targets[i]
          const name = targetName(t)
          const n = counts[i] ?? null
          const empty = n === 0
          return (
            <button
              key={i}
              data-active={i === active}
              onClick={() => onSelect(i)}
              title={`${name}.${t.via}`}
              className={cn(
                'group relative flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] transition-colors',
                i === active ? 'bg-cyan/12 text-fg' : 'hover:bg-hover',
                empty && i !== active && 'opacity-45'
              )}
            >
              {i === active && <span className="absolute top-1.5 bottom-1.5 left-0 w-[2px] rounded-full bg-cyan" />}
              <Table2 className={cn('size-3.5 shrink-0', empty ? 'text-faint' : 'text-ok')} />
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate">
                  <Highlight text={name} q={term} />
                </span>
                {((dupNames.get(name) ?? 0) > 1 || (term && t.via.toLowerCase().includes(term))) && (
                  <span className="truncate font-mono text-[10.5px] text-faint">
                    <Highlight text={t.via} q={term} />
                  </span>
                )}
              </span>
              <span
                className={cn(
                  'shrink-0 rounded-full px-1.5 text-[10.5px] tabular-nums',
                  n === null ? 'text-faint' : empty ? 'text-faint' : 'bg-cyan/15 text-cyan'
                )}
              >
                {formatRefCount(n)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PeekContent({
  connId,
  database,
  target,
  mode,
  emptyText,
  makeNavigate
}: {
  connId: string
  database: string
  target: FkTarget
  mode: 'record' | 'grid' | null
  emptyText: string
  makeNavigate: (maps: FkMaps) => Navigate
}) {
  const [data, setData] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { maps, fkColumns, refColumns } = useFkColumns(connId, database, data?.fields ?? [])
  const navigate = makeNavigate(maps)

  useEffect(() => {
    let cancelled = false
    window.api.table
      .data(connId, database, { schema: target.schema, table: target.table, limit: 200, offset: 0, where: target.where })
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [connId, database, target.schema, target.table, target.where])

  const view = mode ?? (data?.rows.length === 1 ? 'record' : 'grid')

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`${view}|${!!data}`}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        className="absolute inset-0"
      >
        {error ? (
          <div className="m-3 rounded-lg border border-err/30 bg-err/10 p-3 font-mono text-[12px] text-err select-text">{error}</div>
        ) : !data ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : !data.rows.length ? (
          <div className="flex h-full items-center justify-center text-[12.5px] text-faint">{emptyText}</div>
        ) : view === 'record' ? (
          <RecordView data={data} maps={maps} onNavigate={navigate} />
        ) : (
          <DataGrid fields={data.fields} rows={data.rows} fkColumns={fkColumns} refColumns={refColumns} onFkNavigate={navigate} />
        )}
      </motion.div>
    </AnimatePresence>
  )
}

/** Registros em formato de ficha (coluna → valor), um por vez quando houver vários. */
function RecordView({ data, maps, onNavigate }: { data: QueryResult; maps: FkMaps; onNavigate: Navigate }) {
  const [index, setIndex] = useState(0)
  const row = data.rows[Math.min(index, data.rows.length - 1)]
  return (
    <div className="flex h-full flex-col">
      {data.rows.length > 1 && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3 text-[11.5px] text-muted">
          <IconButton size="sm" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
            <ChevronRight className="size-3.5 rotate-180" />
          </IconButton>
          <span className="tabular-nums">
            {index + 1} de {formatCount(data.rows.length)}
          </span>
          <IconButton size="sm" disabled={index >= data.rows.length - 1} onClick={() => setIndex((i) => i + 1)}>
            <ChevronRight className="size-3.5" />
          </IconButton>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        <div className="grid grid-cols-[minmax(120px,max-content)_1fr] gap-x-6">
          {data.fields.map((f, i) => {
            const v = row[i]
            const out = maps.out.get(i)
            const inc = maps.in.get(i)
            return (
              <div key={i} className="contents">
                <div className="flex items-center gap-1.5 border-b border-line py-1.5 text-[12px] text-muted">
                  {out && <Link2 className="size-3 shrink-0 text-violet" />}
                  {inc && <CornerLeftDown className="size-3 shrink-0 text-cyan" />}
                  <span className="truncate">{f.name}</span>
                  <span className="font-mono text-[10px] text-faint">{f.typeName}</span>
                </div>
                <div className="flex min-w-0 items-center gap-2 border-b border-line py-1.5 font-mono text-[12.5px] select-text">
                  {v === null ? (
                    <span className="text-[11.5px] text-faint italic">NULL</span>
                  ) : (
                    <span className={cn('min-w-0 break-all', isJsonType(f.typeName) && 'text-violet')}>{v}</span>
                  )}
                  {v !== null && (out || inc) && (
                    <span className="ml-auto flex shrink-0 gap-0.5">
                      {inc && (
                        <IconButton
                          size="sm"
                          className="text-cyan"
                          title={`Ver registros que referenciam: ${inc.map(fkLabel).join(', ')}`}
                          onClick={(e) => onNavigate('peek', 'in', i, row, e)}
                        >
                          <CornerLeftDown className="size-3.5" />
                        </IconButton>
                      )}
                      {out && (
                        <>
                          <IconButton size="sm" className="text-violet" title={`Ver ${fkLabel(out)} abaixo`} onClick={(e) => onNavigate('peek', 'out', i, row, e)}>
                            <CornerRightDown className="size-3.5" />
                          </IconButton>
                          <IconButton size="sm" title={`Abrir ${fkLabel(out)}`} onClick={(e) => onNavigate('open', 'out', i, row, e)}>
                            <ExternalLink className="size-3.5" />
                          </IconButton>
                        </>
                      )}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

