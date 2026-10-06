import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Ban,
  CalendarClock,
  CalendarDays,
  Check,
  CircleSlash,
  Equal,
  EqualNot,
  Filter,
  FilterX,
  ListChecks,
  ListFilter,
  Search,
  SlidersHorizontal,
  TableProperties,
  TextCursorInput
} from 'lucide-react'
import type { FieldInfo } from '@shared/types'
import {
  OP_LABEL,
  arity,
  filterLabel,
  opsFor,
  typeKind,
  type ColumnFilter,
  type ColumnStats,
  type DistinctValue,
  type FilterOp
} from '@/lib/filters'
import { cn, errorMessage, formatCount } from '@/lib/utils'
import { Button, Modal, Spinner, type MenuEntry } from './ui'

type Cell = string | null
type NewFilter = Omit<ColumnFilter, 'id'>

function show(v: Cell, max = 22): string {
  if (v === null) return 'NULL'
  if (v === '') return "''"
  const one = v.replace(/\s+/g, ' ')
  return one.length > max ? `${one.slice(0, max)}…` : one
}

// ───────────────────────────── menus ─────────────────────────────

interface FilterMenuCtx {
  field: FieldInfo
  add: (f: NewFilter) => void
  /** filtros ativos nesta coluna */
  active: ColumnFilter[]
  clearColumn: () => void
  openTool: (kind: 'values' | 'custom' | 'stats', preset?: { op: FilterOp; values: Cell[] }) => void
}

/** Itens de filtro do menu de uma célula: atalhos para o valor clicado (ou valores selecionados). */
export function cellFilterMenu(ctx: FilterMenuCtx & { value: Cell; selected: Cell[] }): MenuEntry[] {
  const { field, add, value, selected } = ctx
  const kind = typeKind(field.typeName)
  const f = (op: FilterOp, values: Cell[] = []): (() => void) => () => add({ column: field.name, typeName: field.typeName, op, values })
  const v = show(value)

  const more: MenuEntry[] = []
  if (value === null) {
    more.push({ label: 'É NULL', icon: <CircleSlash />, onSelect: f('isNull') }, { label: 'Não é NULL', icon: <Ban />, onSelect: f('notNull') })
  } else {
    if (kind === 'number' || kind === 'date') {
      more.push(
        { heading: 'Comparar' },
        { label: `Maior que`, hint: v, icon: <span className="font-mono text-[12px]">&gt;</span>, onSelect: f('gt', [value]) },
        { label: `Maior ou igual a`, hint: v, icon: <span className="font-mono text-[12px]">≥</span>, onSelect: f('gte', [value]) },
        { label: `Menor que`, hint: v, icon: <span className="font-mono text-[12px]">&lt;</span>, onSelect: f('lt', [value]) },
        { label: `Menor ou igual a`, hint: v, icon: <span className="font-mono text-[12px]">≤</span>, onSelect: f('lte', [value]) }
      )
    }
    if (kind === 'date') {
      more.push(
        { heading: 'Período' },
        { label: 'No mesmo dia', hint: value.slice(0, 10), icon: <CalendarDays />, onSelect: f('sameDay', [value]) },
        { label: 'Últimas 24 horas', icon: <CalendarClock />, onSelect: f('lastHours', ['24']) },
        { label: 'Últimos 7 dias', icon: <CalendarClock />, onSelect: f('lastDays', ['7']) },
        { label: 'Últimos 30 dias', icon: <CalendarClock />, onSelect: f('lastDays', ['30']) },
        { label: 'Neste mês', icon: <CalendarDays />, onSelect: f('thisMonth') },
        { label: 'Neste ano', icon: <CalendarDays />, onSelect: f('thisYear') }
      )
    }
    if (kind === 'text' || kind === 'json') {
      more.push(
        { heading: 'Texto' },
        { label: 'Contém', hint: v, icon: <TextCursorInput />, onSelect: f('contains', [value]) },
        { label: 'Não contém', hint: v, icon: <TextCursorInput />, onSelect: f('notContains', [value]) }
      )
      if (kind === 'text') {
        more.push(
          { label: 'Começa com', hint: v, icon: <TextCursorInput />, onSelect: f('startsWith', [value]) },
          { label: 'Termina com', hint: v, icon: <TextCursorInput />, onSelect: f('endsWith', [value]) },
          { label: 'É vazio', icon: <CircleSlash />, onSelect: f('isEmpty') }
        )
      }
    }
    more.push({ heading: 'Nulos' }, { label: 'É NULL', icon: <CircleSlash />, onSelect: f('isNull') }, { label: 'Não é NULL', icon: <Ban />, onSelect: f('notNull') })
  }
  more.push('separator', {
    label: 'Filtro personalizado…',
    icon: <SlidersHorizontal />,
    onSelect: () => ctx.openTool('custom', { op: value === null ? 'isNull' : kind === 'text' ? 'contains' : 'eq', values: [value] })
  })

  const items: MenuEntry[] = []
  const distinctSel = [...new Set(selected)]
  if (distinctSel.length > 1) {
    // várias células da coluna selecionadas
    items.push(
      { label: `Filtrar pelos ${distinctSel.length} valores selecionados`, icon: <ListChecks />, onSelect: f('in', distinctSel) },
      { label: `Excluir os ${distinctSel.length} valores selecionados`, icon: <ListFilter />, onSelect: f('notIn', distinctSel) }
    )
    const present = distinctSel.filter((x): x is string => x !== null)
    if ((kind === 'number' || kind === 'date') && present.length > 1) {
      const sorted = [...present].sort((a, b) => (kind === 'number' ? Number(a) - Number(b) : a.localeCompare(b)))
      items.push({
        label: 'Entre o menor e o maior selecionado',
        hint: `${show(sorted[0], 12)} – ${show(sorted[sorted.length - 1], 12)}`,
        icon: <SlidersHorizontal />,
        onSelect: f('between', [sorted[0], sorted[sorted.length - 1]])
      })
    }
  } else if (kind === 'bool' && value !== null) {
    const on = value === 't' || value === 'true'
    items.push(
      { label: `Somente ${on ? 'true' : 'false'}`, icon: <Equal />, onSelect: f(on ? 'isTrue' : 'isFalse') },
      { label: `Somente ${on ? 'false' : 'true'}`, icon: <EqualNot />, onSelect: f(on ? 'isFalse' : 'isTrue') }
    )
  } else {
    items.push(
      { label: 'Filtrar por este valor', hint: v, icon: <Equal />, onSelect: f(value === null ? 'isNull' : 'eq', [value]) },
      { label: 'Excluir este valor', hint: v, icon: <EqualNot />, onSelect: f(value === null ? 'notNull' : 'neq', [value]) }
    )
  }
  items.push({ label: 'Mais filtros', icon: <Filter />, children: more })
  if (ctx.active.length) {
    items.push({ label: `Remover filtros de ${field.name}`, icon: <FilterX />, onSelect: ctx.clearColumn })
  }
  return items
}

/** Itens de filtro/análise do menu do cabeçalho. */
export function headerFilterMenu(
  ctx: FilterMenuCtx & { sort?: (dir: 'asc' | 'desc') => void; groupCount?: () => void }
): MenuEntry[] {
  const { field, add } = ctx
  const kind = typeKind(field.typeName)
  const f = (op: FilterOp, values: Cell[] = []): (() => void) => () => add({ column: field.name, typeName: field.typeName, op, values })
  const items: MenuEntry[] = []
  if (ctx.sort) {
    items.push(
      { label: 'Ordenar crescente', icon: <ArrowUp />, onSelect: () => ctx.sort!('asc') },
      { label: 'Ordenar decrescente', icon: <ArrowDown />, onSelect: () => ctx.sort!('desc') },
      'separator'
    )
  }
  const quick: MenuEntry[] = []
  if (kind === 'bool') quick.push({ label: 'É true', icon: <Equal />, onSelect: f('isTrue') }, { label: 'É false', icon: <EqualNot />, onSelect: f('isFalse') })
  if (kind === 'date') {
    quick.push(
      { label: 'Últimas 24 horas', icon: <CalendarClock />, onSelect: f('lastHours', ['24']) },
      { label: 'Últimos 7 dias', icon: <CalendarClock />, onSelect: f('lastDays', ['7']) },
      { label: 'Últimos 30 dias', icon: <CalendarClock />, onSelect: f('lastDays', ['30']) },
      { label: 'Neste mês', icon: <CalendarDays />, onSelect: f('thisMonth') },
      { label: 'Neste ano', icon: <CalendarDays />, onSelect: f('thisYear') },
      'separator'
    )
  }
  if (kind === 'text') quick.push({ label: 'É vazio', icon: <CircleSlash />, onSelect: f('isEmpty') }, { label: 'Não é vazio', icon: <Ban />, onSelect: f('notEmpty') })
  quick.push({ label: 'É NULL', icon: <CircleSlash />, onSelect: f('isNull') }, { label: 'Não é NULL', icon: <Ban />, onSelect: f('notNull') })

  items.push(
    { label: 'Escolher valores…', icon: <ListChecks />, onSelect: () => ctx.openTool('values') },
    { label: 'Filtro personalizado…', icon: <SlidersHorizontal />, onSelect: () => ctx.openTool('custom') },
    { label: 'Filtros rápidos', icon: <Filter />, children: quick }
  )
  if (ctx.active.length) items.push({ label: `Remover filtros de ${field.name}`, icon: <FilterX />, onSelect: ctx.clearColumn })
  items.push('separator', { label: 'Resumo da coluna', icon: <BarChart3 />, onSelect: () => ctx.openTool('stats') })
  if (ctx.groupCount) items.push({ label: 'Contar por valor (nova consulta)', icon: <TableProperties />, onSelect: ctx.groupCount })
  return items
}

// ───────────────────────────── escolher valores ─────────────────────────────

export function ValuePickerDialog({
  field,
  load,
  current,
  onApply,
  onClose
}: {
  field: FieldInfo
  load: () => Promise<DistinctValue[]>
  /** filtro "em" atual da coluna, para vir pré-marcado */
  current?: ColumnFilter
  onApply: (f: NewFilter) => void
  onClose: () => void
}) {
  const [values, setValues] = useState<DistinctValue[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [checked, setChecked] = useState<Set<Cell>>(new Set(current?.op === 'in' ? current.values : []))
  const [exclude, setExclude] = useState(false)

  useEffect(() => {
    load()
      .then(setValues)
      .catch((e) => setError(errorMessage(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const term = q.trim().toLowerCase()
  const visible = useMemo(
    () => (values ?? []).filter((v) => !term || (v.value ?? 'null').toLowerCase().includes(term)),
    [values, term]
  )
  const max = Math.max(1, ...(values ?? []).map((v) => v.count))

  const toggle = (v: Cell): void =>
    setChecked((s) => {
      const n = new Set(s)
      if (n.has(v)) n.delete(v)
      else n.add(v)
      return n
    })

  const apply = (): void => {
    if (!checked.size) return
    onApply({ column: field.name, typeName: field.typeName, op: exclude ? 'notIn' : 'in', values: [...checked] })
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={`Valores de ${field.name}`} description="Marque os valores para filtrar. A barra mostra a frequência de cada um." icon={<ListChecks className="size-4.5" />} width={480}>
      <div className="px-5 pb-5">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex h-8 flex-1 items-center gap-2 rounded-lg bg-bg px-2.5 ring-1 ring-line-strong focus-within:ring-accent">
            <Search className="size-3.5 text-faint" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && apply()}
              placeholder="Buscar valor…"
              className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-faint"
            />
          </div>
          <Button size="sm" variant="ghost" onClick={() => setChecked(new Set(visible.map((v) => v.value)))}>
            Marcar {term ? 'filtrados' : 'todos'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>
            Limpar
          </Button>
        </div>

        <div className="h-[340px] overflow-auto rounded-xl border border-line bg-bg p-1">
          {error && <div className="p-3 text-[12px] text-err">{error}</div>}
          {!values && !error && (
            <div className="flex h-full items-center justify-center">
              <Spinner />
            </div>
          )}
          {values && !visible.length && <div className="p-6 text-center text-[12px] text-faint">Nenhum valor encontrado</div>}
          {visible.map((v, i) => {
            const on = checked.has(v.value)
            return (
              <button
                key={i}
                onClick={() => toggle(v.value)}
                className="relative flex h-7 w-full items-center gap-2.5 overflow-hidden rounded-md px-2 text-left text-[12.5px] hover:bg-hover"
              >
                <span className="absolute inset-y-1 left-0 rounded-r bg-accent/[0.08]" style={{ width: `${(v.count / max) * 100}%` }} />
                <span
                  className={cn(
                    'relative flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                    on ? 'border-accent bg-accent text-white' : 'border-line-strong bg-panel'
                  )}
                >
                  {on && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span className={cn('relative flex-1 truncate font-mono', v.value === null && 'text-faint italic')}>{show(v.value, 60)}</span>
                <span className="relative shrink-0 text-[11px] text-muted tabular-nums">{formatCount(v.count)}</span>
              </button>
            )
          })}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <label className="flex items-center gap-2 text-[12px] text-muted">
            <input type="checkbox" checked={exclude} onChange={(e) => setExclude(e.target.checked)} className="accent-[var(--color-accent)]" />
            Excluir os marcados (em vez de manter)
          </label>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" disabled={!checked.size} onClick={apply}>
              Filtrar {checked.size ? `(${checked.size})` : ''}
            </Button>
          </div>
        </div>
        {values && values.length >= 500 && <div className="mt-2 text-[11px] text-faint">Mostrando os 500 valores mais frequentes.</div>}
      </div>
    </Modal>
  )
}

// ───────────────────────────── filtro personalizado ─────────────────────────────

export function CustomFilterDialog({
  field,
  preset,
  onApply,
  onClose
}: {
  field: FieldInfo
  preset?: { op: FilterOp; values: Cell[] }
  onApply: (f: NewFilter) => void
  onClose: () => void
}) {
  const kind = typeKind(field.typeName)
  const ops = opsFor(kind)
  const [op, setOp] = useState<FilterOp>(preset && ops.includes(preset.op) ? preset.op : ops[0])
  const [a, setA] = useState(preset?.values[0] ?? '')
  const [b, setB] = useState(preset?.values[1] ?? '')
  const [list, setList] = useState((preset?.values ?? []).filter((v) => v !== null).join('\n'))
  const n = arity(op)
  const isRelative = op === 'lastDays' || op === 'lastHours'

  useEffect(() => {
    if (op === 'lastDays' && !/^\d+$/.test(a)) setA('7')
    if (op === 'lastHours' && !/^\d+$/.test(a)) setA('24')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op])

  const values: Cell[] =
    n === 0 ? [] : n === -1 ? list.split('\n').map((s) => s.trim()).filter(Boolean) : n === 2 ? [a, b] : [a]
  const valid = n === 0 || (n === -1 ? values.length > 0 : values.every((v) => v !== null && v !== ''))
  const draft: NewFilter = { column: field.name, typeName: field.typeName, op, values }

  const apply = (): void => {
    if (!valid) return
    onApply(draft)
    onClose()
  }

  const inputType = kind === 'number' ? 'number' : 'text'
  const placeholder = kind === 'date' ? 'AAAA-MM-DD ou AAAA-MM-DD HH:MM' : kind === 'number' ? '0' : 'valor'

  return (
    <Modal open onClose={onClose} title={`Filtrar ${field.name}`} description={field.typeName} icon={<SlidersHorizontal className="size-4.5" />} width={460}>
      <form
        className="space-y-3 px-5 pb-5"
        onSubmit={(e) => {
          e.preventDefault()
          apply()
        }}
      >
        <div className="grid grid-cols-2 gap-1">
          {ops.map((o) => (
            <button
              type="button"
              key={o}
              onClick={() => setOp(o)}
              className={cn(
                'h-7 rounded-md px-2 text-left text-[12px] transition-colors',
                o === op ? 'bg-accent/20 text-fg ring-1 ring-accent/50' : 'text-muted hover:bg-hover hover:text-fg'
              )}
            >
              {OP_LABEL[o]}
            </button>
          ))}
        </div>

        {n === 1 && (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              className="field font-mono"
              type={isRelative ? 'number' : inputType}
              min={isRelative ? 1 : undefined}
              value={a ?? ''}
              onChange={(e) => setA(e.target.value)}
              placeholder={placeholder}
            />
            {isRelative && <span className="text-[12px] text-muted">{op === 'lastDays' ? 'dias' : 'horas'}</span>}
          </div>
        )}
        {n === 2 && (
          <div className="flex items-center gap-2">
            <input autoFocus className="field font-mono" type={inputType} value={a ?? ''} onChange={(e) => setA(e.target.value)} placeholder={placeholder} />
            <span className="text-[12px] text-muted">e</span>
            <input className="field font-mono" type={inputType} value={b ?? ''} onChange={(e) => setB(e.target.value)} placeholder={placeholder} />
          </div>
        )}
        {n === -1 && (
          <textarea
            autoFocus
            value={list}
            onChange={(e) => setList(e.target.value)}
            rows={5}
            placeholder="um valor por linha"
            className="field h-auto py-2 font-mono"
          />
        )}

        <div className="rounded-lg bg-bg px-3 py-2 font-mono text-[12px] text-muted ring-1 ring-line">
          {valid ? filterLabel({ ...draft, id: '' }) : <span className="text-faint">preencha o valor…</span>}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={!valid}>
            <Filter className="size-3.5" /> Aplicar filtro
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// ───────────────────────────── resumo da coluna ─────────────────────────────

export function StatsDialog({
  field,
  load,
  onFilterValue,
  onClose
}: {
  field: FieldInfo
  load: () => Promise<ColumnStats>
  onFilterValue: (v: Cell) => void
  onClose: () => void
}) {
  const [stats, setStats] = useState<ColumnStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
      .then(setStats)
      .catch((e) => setError(errorMessage(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pct = (n: number): string => (stats && stats.total ? `${((n / stats.total) * 100).toFixed(n === 0 || n === stats.total ? 0 : 1)}%` : '')
  const max = Math.max(1, ...(stats?.top ?? []).map((t) => t.count))

  return (
    <Modal open onClose={onClose} title={`Resumo de ${field.name}`} description={field.typeName} icon={<BarChart3 className="size-4.5" />} width={520}>
      <div className="px-5 pb-5">
        {error && <div className="rounded-lg bg-err/10 p-3 text-[12px] text-err">{error}</div>}
        {!stats && !error && (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        )}
        {stats && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Linhas" value={formatCount(stats.total)} />
              <Stat label="Nulos" value={formatCount(stats.nulls)} hint={pct(stats.nulls)} />
              <Stat label="Distintos" value={formatCount(stats.distinct)} hint={pct(stats.distinct)} />
              <Stat label="Mínimo" value={show(stats.min, 26)} mono />
              <Stat label="Máximo" value={show(stats.max, 26)} mono />
              {stats.avg !== null ? <Stat label="Média" value={stats.avg} mono /> : <div />}
            </div>
            <h4 className="mt-5 mb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">Valores mais comuns</h4>
            <div className="space-y-0.5">
              {stats.top.map((t, i) => (
                <button
                  key={i}
                  onClick={() => {
                    onFilterValue(t.value)
                    onClose()
                  }}
                  title="Filtrar por este valor"
                  className="relative flex h-7 w-full items-center gap-3 overflow-hidden rounded-md px-2 text-left text-[12.5px] hover:bg-hover"
                >
                  <span className="absolute inset-y-1 left-0 rounded-r bg-accent/[0.12]" style={{ width: `${(t.count / max) * 100}%` }} />
                  <span className={cn('relative flex-1 truncate font-mono', t.value === null && 'text-faint italic')}>{show(t.value, 50)}</span>
                  <span className="relative text-[11.5px] text-muted tabular-nums">
                    {formatCount(t.count)} <span className="text-faint">· {pct(t.count)}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-faint">
              {stats.scope === 'table'
                ? 'Calculado sobre a tabela inteira, respeitando os filtros ativos. Clique num valor para filtrar.'
                : 'Calculado sobre as linhas carregadas no resultado. Clique num valor para filtrar.'}
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}

function Stat({ label, value, hint, mono }: { label: string; value: ReactNode; hint?: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-bg px-3 py-2">
      <div className="text-[10.5px] font-semibold tracking-wide text-faint uppercase">{label}</div>
      <div className={cn('mt-0.5 truncate text-[14px] text-fg', mono && 'font-mono text-[12.5px]')}>{value}</div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  )
}

// ───────────────────────────── chips ─────────────────────────────

export function FilterChips({
  filters,
  onRemove,
  onClear,
  summary
}: {
  filters: ColumnFilter[]
  onRemove: (id: string) => void
  onClear: () => void
  summary?: ReactNode
}) {
  if (!filters.length) return null
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-accent/[0.03] px-2 py-1.5">
      <Filter className="ml-1 size-3.5 text-accent" />
      {filters.map((f) => (
        <span
          key={f.id}
          className="flex h-6 items-center gap-1 rounded-md bg-accent/15 pr-0.5 pl-2 font-mono text-[11.5px] text-fg ring-1 ring-accent/30"
          title={filterLabel(f)}
        >
          <span className="max-w-[320px] truncate">{filterLabel(f)}</span>
          <button onClick={() => onRemove(f.id)} className="flex size-5 items-center justify-center rounded text-muted hover:bg-accent/25 hover:text-fg" title="Remover filtro">
            ×
          </button>
        </span>
      ))}
      <button onClick={onClear} className="ml-1 flex items-center gap-1 rounded-md px-1.5 text-[11.5px] text-muted hover:text-fg">
        <FilterX className="size-3.5" /> Limpar
      </button>
      {summary && <span className="ml-auto pr-1 text-[11.5px] text-muted">{summary}</span>}
    </div>
  )
}
