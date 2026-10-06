import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Filter,
  Hash,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  Save,
  Table2,
  TerminalSquare,
  Undo2,
  Columns3
} from 'lucide-react'
import { toast } from 'sonner'
import type { QueryResult, RowChange, TableDetails } from '@shared/types'
import { useTabs, type ObjectTab as ObjectTabModel, type ObjectView } from '@/stores/tabs'
import { useConnections } from '@/stores/connections'
import { cn, errorMessage, formatBytes, formatCount, formatDuration, qualifiedName, quoteIdent, uid } from '@/lib/utils'
import { filterToSql, typeKind, type ColumnFilter, type ColumnStats, type DistinctValue } from '@/lib/filters'
import { FilterChips } from './ColumnTools'
import { type GridEdits } from './DataGrid'
import { FkGrid } from './FkGrid'
import { SqlEditor } from './SqlEditor'
import { ExportButton, projectResult } from './ResultsPanel'
import { Button, IconButton, Segmented, Spinner } from './ui'

const PAGE_SIZE = 200

export function ObjectTab({ tab, active }: { tab: ObjectTabModel; active: boolean }) {
  const update = useTabs((s) => s.update)
  const status = useConnections((s) => s.status[tab.connId])
  const ensureConnected = useConnections((s) => s.ensureConnected)
  const [details, setDetails] = useState<TableDetails | null>(null)

  const hasData = tab.objKind !== 'function' && tab.objKind !== 'sequence'
  const views: { value: ObjectView; label: React.ReactNode }[] = [
    ...(hasData
      ? [
          { value: 'data' as const, label: (<><Table2 className="size-3.5" />Dados</>) },
          { value: 'structure' as const, label: (<><Columns3 className="size-3.5" />Estrutura</>) }
        ]
      : []),
    { value: 'ddl', label: (<><Code2 className="size-3.5" />DDL</>) }
  ]

  useEffect(() => {
    if (active && status !== 'connected' && status !== 'connecting') void ensureConnected(tab.connId)
  }, [active, status, ensureConnected, tab.connId])

  const loadDetails = useCallback(async () => {
    if (!hasData) return
    try {
      setDetails(await window.api.meta.table(tab.connId, tab.database, tab.schema, tab.name))
    } catch (e) {
      toast.error('Falha ao carregar estrutura', { description: errorMessage(e) })
    }
  }, [hasData, tab.connId, tab.database, tab.schema, tab.name])

  useEffect(() => {
    if (status === 'connected') void loadDetails()
  }, [status, loadDetails])

  const kindLabel = {
    table: 'tabela',
    partitioned: 'tabela particionada',
    view: 'view',
    matview: 'view materializada',
    foreign: 'tabela externa',
    function: 'função',
    sequence: 'sequência'
  }[tab.objKind]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[13.5px] font-semibold tracking-tight">{tab.name}</span>
            <span className="text-[11.5px] text-faint">
              {kindLabel} · {tab.database}.{tab.schema}
            </span>
          </div>
        </div>
        {details && (
          <div className="flex items-center gap-3 text-[11.5px] text-muted">
            <span title="Estimativa do planner">~{formatCount(details.rowEstimate ?? 0)} linhas</span>
            {details.sizeBytes != null && <span>{formatBytes(details.sizeBytes)}</span>}
          </div>
        )}
        <div className="flex-1" />
        <Segmented layoutId={`objview-${tab.id}`} value={tab.view} options={views} onChange={(view) => update(tab.id, { view })} />
      </div>

      <div className="relative min-h-0 flex-1">
        {status !== 'connected' ? (
          <div className="flex h-full items-center justify-center gap-2 text-muted">
            <Spinner /> Conectando…
          </div>
        ) : (
          <>
            {hasData && (
              <div className={cn('h-full', tab.view !== 'data' && 'hidden')}>
                <DataView tab={tab} details={details} />
              </div>
            )}
            {tab.view === 'structure' && <StructureView details={details} />}
            {tab.view === 'ddl' && <DdlView tab={tab} />}
          </>
        )}
      </div>
    </div>
  )
}

// ───────────────────────────── dados ─────────────────────────────

function emptyEdits(from: number): GridEdits {
  return { cells: new Map(), deleted: new Set(), insertedFrom: from }
}

function DataView({ tab, details }: { tab: ObjectTabModel; details: TableDetails | null }) {
  const [data, setData] = useState<QueryResult | null>(null)
  const [rows, setRows] = useState<(string | null)[][]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [filter, setFilter] = useState(tab.filter ?? '')
  const [appliedFilter, setAppliedFilter] = useState(tab.filter ?? '')
  const [sort, setSort] = useState<{ column: string; dir: 'asc' | 'desc' } | null>(null)
  const [edits, setEdits] = useState<GridEdits>(emptyEdits(0))
  const [saving, setSaving] = useState(false)
  const [total, setTotal] = useState<number | null>(null)
  const [visibleCols, setVisibleCols] = useState<number[] | null>(null)
  const [colFilters, setColFilters] = useState<ColumnFilter[]>([])
  const newQuery = useTabs((s) => s.newQuery)

  // WHERE efetivo: texto livre + filtros de coluna (chips), tudo com AND
  const where = useMemo(
    () => [appliedFilter.trim() && `(${appliedFilter.trim()})`, ...colFilters.map((f) => `(${filterToSql(f)})`)].filter(Boolean).join(' and '),
    [appliedFilter, colFilters]
  )

  const pkColumns = useMemo(() => details?.columns.filter((c) => c.isPrimaryKey).map((c) => c.name) ?? [], [details])
  const isTable = tab.objKind === 'table' || tab.objKind === 'partitioned' || tab.objKind === 'foreign'
  const editable = isTable && pkColumns.length > 0
  const pendingCount =
    [...edits.cells.keys()].filter((r) => r < edits.insertedFrom && !edits.deleted.has(r)).length +
    edits.deleted.size +
    Math.max(0, rows.length - edits.insertedFrom)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.api.table.data(tab.connId, tab.database, {
        schema: tab.schema,
        table: tab.name,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        where,
        orderBy: sort
      })
      setData(res)
      setRows(res.rows)
      setEdits(emptyEdits(res.rows.length))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [tab.connId, tab.database, tab.schema, tab.name, page, where, sort])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => setTotal(null), [where])

  // filtro vindo de navegação por FK
  useEffect(() => {
    if (tab.filterNonce === undefined) return
    setFilter(tab.filter ?? '')
    setAppliedFilter(tab.filter ?? '')
    setColFilters([])
    setPage(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.filterNonce])

  const countRows = async (): Promise<void> => {
    try {
      setTotal(await window.api.table.count(tab.connId, tab.database, tab.schema, tab.name, where))
    } catch (e) {
      toast.error('Falha ao contar', { description: errorMessage(e) })
    }
  }

  const onEdit = (row: number, col: number, value: string | null): void => {
    setEdits((e) => {
      const cells = new Map(e.cells)
      const rowMap = new Map(cells.get(row) ?? [])
      if (row < e.insertedFrom && rows[row][col] === value) rowMap.delete(col)
      else rowMap.set(col, value)
      if (rowMap.size) cells.set(row, rowMap)
      else cells.delete(row)
      return { ...e, cells }
    })
  }

  const onDeleteRows = (list: number[]): void => {
    const inserted = list.filter((r) => r >= edits.insertedFrom)
    const existing = list.filter((r) => r < edits.insertedFrom)
    if (inserted.length) {
      // remove linhas novas ainda não salvas
      const keep = new Set(inserted)
      const remap = new Map<number, number>()
      let next = edits.insertedFrom
      rows.forEach((_, i) => {
        if (i >= edits.insertedFrom && !keep.has(i)) remap.set(i, next++)
      })
      setRows((rs) => rs.filter((_, i) => !keep.has(i)))
      setEdits((e) => {
        const cells = new Map<number, Map<number, string | null>>()
        for (const [r, m] of e.cells) {
          if (r < e.insertedFrom) cells.set(r, m)
          else if (remap.has(r)) cells.set(remap.get(r)!, m)
        }
        return { ...e, cells }
      })
    }
    if (existing.length) setEdits((e) => ({ ...e, deleted: new Set([...e.deleted, ...existing]) }))
  }

  const onRevertRows = (list: number[]): void => {
    setEdits((e) => {
      const cells = new Map(e.cells)
      const deleted = new Set(e.deleted)
      for (const r of list) {
        if (r < e.insertedFrom) cells.delete(r)
        deleted.delete(r)
      }
      return { ...e, cells, deleted }
    })
  }

  const addRow = (): void => {
    if (!data) return
    setRows((rs) => [...rs, data.fields.map(() => null)])
  }

  const discard = (): void => {
    setRows(data?.rows ?? [])
    setEdits(emptyEdits(data?.rows.length ?? 0))
  }

  const save = async (): Promise<void> => {
    if (!data) return
    const fields = data.fields
    const keyOf = (r: number): Record<string, string | null> =>
      Object.fromEntries(pkColumns.map((pk) => [pk, rows[r][fields.findIndex((f) => f.name === pk)]]))
    const valuesOf = (r: number): Record<string, string | null> =>
      Object.fromEntries([...(edits.cells.get(r) ?? [])].map(([c, v]) => [fields[c].name, v]))

    const changes: RowChange[] = []
    for (const r of edits.deleted) changes.push({ kind: 'delete', key: keyOf(r) })
    for (const [r] of edits.cells) {
      if (r < edits.insertedFrom && !edits.deleted.has(r)) changes.push({ kind: 'update', key: keyOf(r), values: valuesOf(r) })
    }
    for (let r = edits.insertedFrom; r < rows.length; r++) changes.push({ kind: 'insert', values: valuesOf(r) })

    setSaving(true)
    try {
      const n = await window.api.table.apply(tab.connId, tab.database, tab.schema, tab.name, changes)
      toast.success('Alterações salvas', { description: `${n} ${n === 1 ? 'linha afetada' : 'linhas afetadas'}` })
      await load()
    } catch (e) {
      toast.error('Falha ao salvar', { description: errorMessage(e) })
    } finally {
      setSaving(false)
    }
  }

  const onSort = (column: string, dir?: 'asc' | 'desc'): void => {
    setSort((s) => (dir ? { column, dir } : s?.column !== column ? { column, dir: 'asc' } : s.dir === 'asc' ? { column, dir: 'desc' } : null))
    setPage(0)
  }

  /** filtros recarregam a página: alterações não salvas se perderiam */
  const guardEdits = (): boolean => {
    if (pendingCount === 0) return true
    toast.message('Salve ou descarte as alterações antes de filtrar')
    return false
  }

  const addFilter = (f: Omit<ColumnFilter, 'id'>): void => {
    if (!guardEdits()) return
    // um novo filtro substitui o de mesmo operador na mesma coluna; operadores diferentes se somam (AND)
    setColFilters((list) => [...list.filter((x) => !(x.column === f.column && x.op === f.op)), { ...f, id: uid() }])
    setPage(0)
  }

  const updateFilters = (fn: (list: ColumnFilter[]) => ColumnFilter[]): void => {
    if (!guardEdits()) return
    setColFilters(fn)
    setPage(0)
  }

  const fieldAt = (col: number): string => data!.fields[col].name

  const loadDistinct = async (col: number): Promise<DistinctValue[]> =>
    window.api.table.distinct(tab.connId, tab.database, tab.schema, tab.name, fieldAt(col), where)

  const loadStats = async (col: number): Promise<ColumnStats> => {
    const field = data!.fields[col]
    const kind = typeKind(field.typeName)
    const [base, top] = await Promise.all([
      window.api.table.stats(tab.connId, tab.database, tab.schema, tab.name, field.name, {
        where,
        minMax: kind === 'number' || kind === 'date' || kind === 'text',
        avg: kind === 'number'
      }),
      window.api.table.distinct(tab.connId, tab.database, tab.schema, tab.name, field.name, where, 10)
    ])
    const avg = base.avg === null ? null : Number(base.avg).toLocaleString('pt-BR', { maximumFractionDigits: 4 })
    return { ...base, avg, top, scope: 'table' }
  }

  const groupCount = (column: string): void => {
    const col = quoteIdent(column)
    const sql = [`SELECT ${col}, count(*) AS total`, `FROM ${qualifiedName(tab.schema, tab.name)}`]
    if (where) sql.push(`WHERE ${where}`)
    sql.push('GROUP BY 1', 'ORDER BY 2 DESC;')
    newQuery({ connId: tab.connId, database: tab.database, sql: sql.join('\n'), title: `${tab.name} · ${column}` })
  }

  const fromRow = page * PAGE_SIZE + 1
  const toRow = page * PAGE_SIZE + (data?.rows.length ?? 0)
  const hasNext = (data?.rows.length ?? 0) === PAGE_SIZE

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-2">
        <div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-lg bg-bg px-2.5 ring-1 ring-line-strong transition-shadow focus-within:ring-accent focus-within:shadow-[0_0_0_3px_#6d8cff22]">
          <Filter className="size-3.5 shrink-0 text-faint" />
          <span className="font-mono text-[12px] text-accent/80">WHERE</span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setPage(0)
                setAppliedFilter(filter)
                if (filter === appliedFilter) void load()
              }
            }}
            placeholder="id > 100 and status = 'ativo'"
            className="min-w-0 flex-1 bg-transparent font-mono text-[12px] outline-none placeholder:text-faint"
            spellCheck={false}
          />
        </div>
        <IconButton title="Recarregar" onClick={() => void load()}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </IconButton>
        {editable && (
          <IconButton title="Adicionar linha" onClick={addRow}>
            <Plus className="size-4" />
          </IconButton>
        )}
        {data && (
          <ExportButton
            result={projectResult({ ...data, rows }, visibleCols)}
            name={tab.name}
            tableName={qualifiedName(tab.schema, tab.name)}
          />
        )}
      </div>

      <FilterChips
        filters={colFilters}
        onRemove={(id) => updateFilters((l) => l.filter((f) => f.id !== id))}
        onClear={() => updateFilters(() => [])}
        summary={total != null ? `${formatCount(total)} ${total === 1 ? 'linha' : 'linhas'}` : undefined}
      />

      <div className="relative min-h-0 flex-1">
        {error ? (
          <div className="m-4 rounded-xl border border-err/30 bg-err/10 p-4 font-mono text-[12.5px] text-err select-text">{error}</div>
        ) : data ? (
          <FkGrid
            connId={tab.connId}
            database={tab.database}
            fields={data.fields}
            rows={rows}
            rowOffset={page * PAGE_SIZE}
            sort={sort}
            onSort={onSort}
            editable={editable}
            pkColumns={pkColumns}
            edits={edits}
            onEdit={onEdit}
            onDeleteRows={onDeleteRows}
            onRevertRows={onRevertRows}
            tableName={qualifiedName(tab.schema, tab.name)}
            layoutKey={`${tab.connId}|${tab.database}|${tab.schema}.${tab.name}`}
            onVisibleColumnsChange={setVisibleCols}
            filters={colFilters}
            onAddFilter={addFilter}
            onClearColumnFilters={(column) => updateFilters((l) => l.filter((f) => f.column !== column))}
            loadDistinct={loadDistinct}
            loadStats={loadStats}
            onGroupCount={groupCount}
            emptyText={where ? 'Nenhuma linha corresponde ao filtro' : 'Tabela vazia'}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        )}

        <AnimatePresence>
          {pendingCount > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-line-strong bg-[#151922f0] py-2 pr-2 pl-4 shadow-[0_20px_50px_-12px_#000000d0] backdrop-blur-xl"
            >
              <span className="text-[12.5px]">
                <span className="font-semibold text-warn">{pendingCount}</span>{' '}
                {pendingCount === 1 ? 'alteração pendente' : 'alterações pendentes'}
              </span>
              <Button size="sm" variant="ghost" onClick={discard}>
                <Undo2 className="size-3.5" /> Descartar
              </Button>
              <Button size="sm" variant="primary" onClick={save} loading={saving}>
                <Save className="size-3.5" /> Salvar
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex h-8 shrink-0 items-center gap-3 border-t border-line bg-panel px-3 text-[11.5px] text-muted">
        {!editable && isTable && details && (
          <span className="text-faint" title="Edição requer chave primária">somente leitura (sem PK)</span>
        )}
        {!isTable && <span className="text-faint">somente leitura</span>}
        <div className="flex-1" />
        {data && <span>{formatDuration(data.durationMs)}</span>}
        <span className="tabular-nums">
          {data?.rows.length ? `${formatCount(fromRow)}–${formatCount(toRow)}` : '0'}
          {total != null ? ` de ${formatCount(total)}` : ''}
        </span>
        {total == null && (
          <button className="text-accent hover:underline" onClick={countRows}>
            contar
          </button>
        )}
        <div className="flex items-center">
          <IconButton size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} title="Página anterior">
            <ChevronLeft className="size-3.5" />
          </IconButton>
          <span className="px-1 tabular-nums">{page + 1}</span>
          <IconButton size="sm" disabled={!hasNext} onClick={() => setPage((p) => p + 1)} title="Próxima página">
            <ChevronRight className="size-3.5" />
          </IconButton>
        </div>
      </div>
    </div>
  )
}

// ───────────────────────────── estrutura ─────────────────────────────

function StructureView({ details }: { details: TableDetails | null }) {
  if (!details) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }
  const conLabel: Record<string, string> = { p: 'PRIMARY KEY', f: 'FOREIGN KEY', u: 'UNIQUE', c: 'CHECK', x: 'EXCLUDE' }
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1100px] space-y-6 p-6">
        {details.comment && <p className="text-[13px] text-muted">{details.comment}</p>}
        <Section title="Colunas" count={details.columns.length}>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] text-faint uppercase">
                <th className="w-10 py-2 pl-4 font-medium">#</th>
                <th className="py-2 font-medium">Nome</th>
                <th className="py-2 font-medium">Tipo</th>
                <th className="py-2 font-medium">Nulo</th>
                <th className="py-2 font-medium">Default</th>
                <th className="py-2 pr-4 font-medium">Comentário</th>
              </tr>
            </thead>
            <tbody>
              {details.columns.map((c) => (
                <tr key={c.name} className="border-t border-line transition-colors hover:bg-white/[0.02]">
                  <td className="py-2 pl-4 text-faint tabular-nums">{c.position}</td>
                  <td className="py-2 font-medium">
                    <span className="flex items-center gap-1.5 select-text">
                      {c.isPrimaryKey && <KeyRound className="size-3.5 text-warn" />}
                      {c.name}
                    </span>
                  </td>
                  <td className="py-2 font-mono text-[12px] text-cyan select-text">{c.type}</td>
                  <td className="py-2">{c.nullable ? <span className="text-muted">sim</span> : <span className="text-fg">NOT NULL</span>}</td>
                  <td className="max-w-[260px] truncate py-2 font-mono text-[12px] text-muted select-text">{c.default ?? ''}</td>
                  <td className="py-2 pr-4 text-muted select-text">{c.comment ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {details.constraints.length > 0 && (
          <Section title="Constraints" count={details.constraints.length}>
            {details.constraints.map((c) => (
              <div key={c.name} className="flex items-start gap-3 border-t border-line px-4 py-2.5 first:border-t-0">
                {c.type === 'f' ? <Link2 className="mt-0.5 size-3.5 text-violet" /> : c.type === 'p' ? <KeyRound className="mt-0.5 size-3.5 text-warn" /> : <Hash className="mt-0.5 size-3.5 text-muted" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium select-text">{c.name}</span>
                    <span className="rounded bg-elev-2 px-1.5 py-px text-[10px] font-semibold tracking-wide text-muted">{conLabel[c.type] ?? c.type}</span>
                  </div>
                  <div className="mt-0.5 font-mono text-[12px] text-muted select-text">{c.definition}</div>
                </div>
              </div>
            ))}
          </Section>
        )}

        {details.indexes.length > 0 && (
          <Section title="Índices" count={details.indexes.length}>
            {details.indexes.map((i) => (
              <div key={i.name} className="flex items-start gap-3 border-t border-line px-4 py-2.5 first:border-t-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium select-text">{i.name}</span>
                    {i.isPrimary && <span className="rounded bg-warn/15 px-1.5 py-px text-[10px] font-semibold text-warn">PK</span>}
                    {i.isUnique && !i.isPrimary && <span className="rounded bg-accent/15 px-1.5 py-px text-[10px] font-semibold text-accent">UNIQUE</span>}
                  </div>
                  <div className="mt-0.5 font-mono text-[12px] text-muted select-text">{i.definition}</div>
                </div>
                <span className="text-[11.5px] text-faint">{formatBytes(i.sizeBytes)}</span>
              </div>
            ))}
          </Section>
        )}
      </div>
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-[12px] font-semibold tracking-wide text-muted uppercase">
        {title}
        <span className="rounded-full bg-elev-2 px-1.5 text-[10.5px] text-faint">{count}</span>
      </h3>
      <div className="overflow-hidden rounded-xl border border-line bg-panel">{children}</div>
    </section>
  )
}

// ───────────────────────────── DDL ─────────────────────────────

function DdlView({ tab }: { tab: ObjectTabModel }) {
  const [ddl, setDdl] = useState<string | null>(null)
  const newQuery = useTabs((s) => s.newQuery)

  useEffect(() => {
    window.api.meta
      .ddl(tab.connId, tab.database, tab.schema, tab.name, tab.objKind, tab.args)
      .then(setDdl)
      .catch((e) => setDdl(`-- Falha ao gerar DDL\n-- ${errorMessage(e)}`))
  }, [tab.connId, tab.database, tab.schema, tab.name, tab.objKind, tab.args])

  if (ddl === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }
  return (
    <div className="relative h-full bg-bg">
      <SqlEditor value={ddl} readOnly highlightStatement={false} />
      <div className="absolute top-3 right-4 flex gap-1.5">
        <Button
          size="sm"
          onClick={() => {
            window.api.copy(ddl)
            toast.success('DDL copiado')
          }}
        >
          <Copy className="size-3.5" /> Copiar
        </Button>
        <Button size="sm" onClick={() => newQuery({ connId: tab.connId, database: tab.database, sql: ddl, title: `DDL ${tab.name}` })}>
          <TerminalSquare className="size-3.5" /> Abrir no editor
        </Button>
      </div>
    </div>
  )
}
