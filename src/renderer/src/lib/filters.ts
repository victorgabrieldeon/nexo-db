import { isBoolType, isNumericType } from './pgTypes'

type Cell = string | null

export type FilterOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'in'
  | 'notIn'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'isNull'
  | 'notNull'
  | 'isEmpty'
  | 'notEmpty'
  | 'isTrue'
  | 'isFalse'
  | 'sameDay'
  | 'lastHours'
  | 'lastDays'
  | 'thisMonth'
  | 'thisYear'

export interface ColumnFilter {
  id: string
  column: string
  typeName: string
  op: FilterOp
  values: Cell[]
}

export type TypeKind = 'number' | 'bool' | 'date' | 'json' | 'text'

const DATE_TYPES = new Set(['date', 'timestamp', 'timestamptz'])

export function typeKind(typeName: string): TypeKind {
  if (isNumericType(typeName)) return 'number'
  if (isBoolType(typeName)) return 'bool'
  if (DATE_TYPES.has(typeName)) return 'date'
  if (typeName === 'json' || typeName === 'jsonb') return 'json'
  return 'text'
}

/** Operadores que fazem sentido para cada tipo (ordem de exibição). */
export function opsFor(kind: TypeKind): FilterOp[] {
  const common: FilterOp[] = ['eq', 'neq', 'in', 'notIn', 'isNull', 'notNull']
  switch (kind) {
    case 'number':
      return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'notIn', 'isNull', 'notNull']
    case 'date':
      return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'sameDay', 'lastHours', 'lastDays', 'thisMonth', 'thisYear', 'isNull', 'notNull']
    case 'bool':
      return ['isTrue', 'isFalse', 'isNull', 'notNull']
    case 'json':
      return ['contains', 'notContains', 'isNull', 'notNull']
    default:
      return [...common.slice(0, 2), 'contains', 'notContains', 'startsWith', 'endsWith', 'in', 'notIn', 'isEmpty', 'notEmpty', 'isNull', 'notNull']
  }
}

export const OP_LABEL: Record<FilterOp, string> = {
  eq: 'igual a',
  neq: 'diferente de',
  gt: 'maior que',
  gte: 'maior ou igual a',
  lt: 'menor que',
  lte: 'menor ou igual a',
  between: 'entre',
  in: 'é um destes',
  notIn: 'não é nenhum destes',
  contains: 'contém',
  notContains: 'não contém',
  startsWith: 'começa com',
  endsWith: 'termina com',
  isNull: 'é NULL',
  notNull: 'não é NULL',
  isEmpty: 'é vazio',
  notEmpty: 'não é vazio',
  isTrue: 'é true',
  isFalse: 'é false',
  sameDay: 'no mesmo dia de',
  lastHours: 'nas últimas … horas',
  lastDays: 'nos últimos … dias',
  thisMonth: 'neste mês',
  thisYear: 'neste ano'
}

/** quantos valores o operador pede (0 = nenhum, -1 = lista) */
export function arity(op: FilterOp): number {
  switch (op) {
    case 'isNull':
    case 'notNull':
    case 'isEmpty':
    case 'notEmpty':
    case 'isTrue':
    case 'isFalse':
    case 'thisMonth':
    case 'thisYear':
      return 0
    case 'between':
      return 2
    case 'in':
    case 'notIn':
      return -1
    default:
      return 1
  }
}

function short(v: Cell, max = 28): string {
  if (v === null) return 'NULL'
  return v.length > max ? `${v.slice(0, max)}…` : v
}

/** Texto do chip, ex.: `status = pago`, `nome contém "ana"`. */
export function filterLabel(f: ColumnFilter): string {
  const [a, b] = f.values
  const c = f.column
  switch (f.op) {
    case 'eq':
      return `${c} = ${short(a)}`
    case 'neq':
      return `${c} ≠ ${short(a)}`
    case 'gt':
      return `${c} > ${short(a)}`
    case 'gte':
      return `${c} ≥ ${short(a)}`
    case 'lt':
      return `${c} < ${short(a)}`
    case 'lte':
      return `${c} ≤ ${short(a)}`
    case 'between':
      return `${c} entre ${short(a)} e ${short(b)}`
    case 'in':
    case 'notIn': {
      const shown = f.values.slice(0, 3).map((v) => short(v, 14)).join(', ')
      const more = f.values.length > 3 ? ` +${f.values.length - 3}` : ''
      return `${c} ${f.op === 'in' ? 'em' : 'fora de'} (${shown}${more})`
    }
    case 'contains':
      return `${c} contém "${short(a)}"`
    case 'notContains':
      return `${c} não contém "${short(a)}"`
    case 'startsWith':
      return `${c} começa com "${short(a)}"`
    case 'endsWith':
      return `${c} termina com "${short(a)}"`
    case 'sameDay':
      return `${c} em ${short(a?.slice(0, 10) ?? null)}`
    case 'lastHours':
      return `${c} últimas ${a}h`
    case 'lastDays':
      return `${c} últimos ${a} dias`
    case 'thisMonth':
      return `${c} neste mês`
    case 'thisYear':
      return `${c} neste ano`
    default:
      return `${c} ${OP_LABEL[f.op]}`
  }
}

// ───────────────────────────── SQL (tabelas, no servidor) ─────────────────────────────

function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function lit(v: Cell): string {
  return v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`
}

function likeLit(v: string, prefix: string, suffix: string): string {
  return lit(`${prefix}${v.replace(/[\\%_]/g, '\\$&')}${suffix}`)
}

function positiveInt(v: Cell, fallback: number): number {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function filterToSql(f: ColumnFilter): string {
  const c = ident(f.column)
  const t = `${c}::text`
  const [a, b] = f.values
  const nonNull = f.values.filter((v): v is string => v !== null)
  const hasNull = nonNull.length !== f.values.length
  switch (f.op) {
    case 'eq':
      return a === null ? `${c} is null` : `${c} = ${lit(a)}`
    case 'neq':
      return a === null ? `${c} is not null` : `${c} is distinct from ${lit(a)}`
    case 'gt':
      return `${c} > ${lit(a)}`
    case 'gte':
      return `${c} >= ${lit(a)}`
    case 'lt':
      return `${c} < ${lit(a)}`
    case 'lte':
      return `${c} <= ${lit(a)}`
    case 'between':
      return `${c} between ${lit(a)} and ${lit(b)}`
    case 'in': {
      const parts = []
      if (nonNull.length) parts.push(`${c} in (${nonNull.map(lit).join(', ')})`)
      if (hasNull) parts.push(`${c} is null`)
      return parts.length > 1 ? `(${parts.join(' or ')})` : (parts[0] ?? 'false')
    }
    case 'notIn': {
      const notIn = `${c} not in (${nonNull.map(lit).join(', ')})`
      // `x not in (...)` é NULL quando x é NULL: decide explicitamente se NULL entra ou não
      if (hasNull) return nonNull.length ? `(${notIn} and ${c} is not null)` : `${c} is not null`
      return nonNull.length ? `(${notIn} or ${c} is null)` : 'true'
    }
    case 'contains':
      return `${t} ilike ${likeLit(a ?? '', '%', '%')}`
    case 'notContains':
      return `(${t} not ilike ${likeLit(a ?? '', '%', '%')} or ${c} is null)`
    case 'startsWith':
      return `${t} ilike ${likeLit(a ?? '', '', '%')}`
    case 'endsWith':
      return `${t} ilike ${likeLit(a ?? '', '%', '')}`
    case 'isNull':
      return `${c} is null`
    case 'notNull':
      return `${c} is not null`
    case 'isEmpty':
      return `${c} = ''`
    case 'notEmpty':
      return `(${c} <> '' and ${c} is not null)`
    case 'isTrue':
      return `${c} is true`
    case 'isFalse':
      return `${c} is false`
    case 'sameDay':
      return `${c}::date = ${lit(a?.slice(0, 10) ?? null)}::date`
    case 'lastHours':
      return `${c} >= now() - interval '${positiveInt(a, 24)} hours'`
    case 'lastDays':
      return `${c} >= now() - interval '${positiveInt(a, 7)} days'`
    case 'thisMonth':
      return `date_trunc('month', ${c}) = date_trunc('month', now())`
    case 'thisYear':
      return `date_trunc('year', ${c}) = date_trunc('year', now())`
  }
}

// ───────────────────────────── JS (resultados de consulta, em memória) ─────────────────────────────

/** Converte o texto do Postgres em Date ("2026-10-06 02:00:57.49+00" → ISO válido). */
export function parsePgDate(v: string): Date | null {
  let s = v.trim().replace(' ', 'T')
  if (/[+-]\d{2}$/.test(s)) s += ':00'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function compare(a: string, b: string, kind: TypeKind): number {
  if (kind === 'number') return Number(a) - Number(b)
  if (kind === 'date') {
    const da = parsePgDate(a)
    const db = parsePgDate(b)
    if (da && db) return da.getTime() - db.getTime()
  }
  return a.localeCompare(b, undefined, { numeric: true })
}

function boolValue(v: string): boolean {
  return v === 't' || v === 'true'
}

function same(a: string, b: string, kind: TypeKind): boolean {
  if (kind === 'number') return Number(a) === Number(b)
  if (kind === 'bool') return boolValue(a) === boolValue(b)
  return a === b
}

export function filterMatches(f: ColumnFilter, v: Cell): boolean {
  const kind = typeKind(f.typeName)
  const [a, b] = f.values
  const lower = (s: string): string => s.toLocaleLowerCase()
  switch (f.op) {
    case 'isNull':
      return v === null
    case 'notNull':
      return v !== null
    case 'eq':
      return a === null ? v === null : v !== null && same(v, a, kind)
    case 'neq':
      return a === null ? v !== null : v === null || !same(v, a, kind)
    case 'in':
      return f.values.some((x) => (x === null ? v === null : v !== null && same(v, x, kind)))
    case 'notIn':
      return !f.values.some((x) => (x === null ? v === null : v !== null && same(v, x, kind)))
  }
  if (v === null) return f.op === 'notContains'
  switch (f.op) {
    case 'gt':
      return a !== null && compare(v, a, kind) > 0
    case 'gte':
      return a !== null && compare(v, a, kind) >= 0
    case 'lt':
      return a !== null && compare(v, a, kind) < 0
    case 'lte':
      return a !== null && compare(v, a, kind) <= 0
    case 'between':
      return a !== null && b !== null && compare(v, a, kind) >= 0 && compare(v, b, kind) <= 0
    case 'contains':
      return lower(v).includes(lower(a ?? ''))
    case 'notContains':
      return !lower(v).includes(lower(a ?? ''))
    case 'startsWith':
      return lower(v).startsWith(lower(a ?? ''))
    case 'endsWith':
      return lower(v).endsWith(lower(a ?? ''))
    case 'isEmpty':
      return v === ''
    case 'notEmpty':
      return v !== ''
    case 'isTrue':
      return boolValue(v)
    case 'isFalse':
      return !boolValue(v)
    case 'sameDay':
      return a !== null && v.slice(0, 10) === a.slice(0, 10)
  }
  const d = parsePgDate(v)
  if (!d) return false
  const now = new Date()
  switch (f.op) {
    case 'lastHours':
      return now.getTime() - d.getTime() <= positiveInt(a, 24) * 3600_000 && d <= now
    case 'lastDays':
      return now.getTime() - d.getTime() <= positiveInt(a, 7) * 86400_000 && d <= now
    case 'thisMonth':
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    case 'thisYear':
      return d.getFullYear() === now.getFullYear()
  }
  return true
}

/** Aplica todos os filtros (AND) às linhas, devolvendo os índices que passam. */
export function applyFilters(filters: ColumnFilter[], fieldNames: string[], rows: Cell[][]): Cell[][] {
  if (!filters.length) return rows
  const idx = filters.map((f) => fieldNames.indexOf(f.column))
  return rows.filter((r) => filters.every((f, i) => idx[i] < 0 || filterMatches(f, r[idx[i]])))
}

// ───────────────────────────── estatísticas ─────────────────────────────

export interface ColumnStats {
  total: number
  nulls: number
  distinct: number
  min: string | null
  max: string | null
  avg: string | null
  /** valores mais frequentes (até 10) */
  top: { value: Cell; count: number }[]
  /** a contagem considera todas as linhas da tabela (servidor) ou só as carregadas */
  scope: 'table' | 'loaded'
}

export interface DistinctValue {
  value: Cell
  count: number
}

export function distinctLocal(values: Cell[], limit = 500): DistinctValue[] {
  const counts = new Map<Cell, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((x, y) => y.count - x.count || String(x.value).localeCompare(String(y.value)))
    .slice(0, limit)
}

export function statsLocal(values: Cell[], typeName: string): ColumnStats {
  const kind = typeKind(typeName)
  const present = values.filter((v): v is string => v !== null)
  const sorted = [...present].sort((a, b) => compare(a, b, kind))
  let avg: string | null = null
  if (kind === 'number' && present.length) {
    const sum = present.reduce((s, v) => s + Number(v), 0)
    avg = (sum / present.length).toLocaleString('pt-BR', { maximumFractionDigits: 4 })
  }
  const dist = distinctLocal(values, Number.MAX_SAFE_INTEGER)
  return {
    total: values.length,
    nulls: values.length - present.length,
    distinct: dist.length,
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
    avg,
    top: dist.slice(0, 10),
    scope: 'loaded'
  }
}
