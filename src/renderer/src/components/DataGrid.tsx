import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, ClipboardCopy, Columns3, Copy, CornerLeftDown, CornerRightDown, EyeOff, Eraser, Eye, ExternalLink, FileJson, KeyRound, Link2, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import type { FieldInfo } from '@shared/types'
import { cn } from '@/lib/utils'
import { isBoolType, isJsonType, isNumericType } from '@/lib/pgTypes'
import { showContextMenu, type MenuEntry } from './ui'
import { ValueViewer } from './ValueViewer'
import { ColumnsMenu } from './ColumnsMenu'

type Cell = string | null
const ROW_H = 28
const HEADER_H = 34
const GUTTER_W = 52

export interface GridEdits {
  /** linha (índice na fonte) → coluna → novo valor */
  cells: Map<number, Map<number, Cell>>
  deleted: Set<number>
  /** linhas com índice >= insertedFrom são novas */
  insertedFrom: number
}

export interface DataGridProps {
  fields: FieldInfo[]
  rows: Cell[][]
  rowOffset?: number
  /** ordenação controlada (servidor). Sem onSort a ordenação é local. */
  sort?: { column: string; dir: 'asc' | 'desc' } | null
  onSort?: (column: string) => void
  editable?: boolean
  pkColumns?: string[]
  edits?: GridEdits
  onEdit?: (row: number, col: number, value: Cell) => void
  onDeleteRows?: (rows: number[]) => void
  onRevertRows?: (rows: number[]) => void
  tableName?: string
  emptyText?: string
  /** chave para lembrar ordem/visibilidade das colunas entre sessões (ex.: por tabela) */
  layoutKey?: string
  /** avisa quais colunas (índices na fonte, em ordem de exibição) estão visíveis */
  onVisibleColumnsChange?: (cols: number[]) => void
  /** colunas que são FK (índice na fonte → descrição do destino) */
  fkColumns?: Map<number, string>
  /** colunas referenciadas por FKs de outras tabelas (índice na fonte → descrições das origens) */
  refColumns?: Map<number, string[]>
  /**
   * navegar por FK. dir 'out': segue a FK até o registro referenciado; 'in': traz as linhas que apontam para cá.
   * mode 'open' abre em aba, 'peek' mostra no painel inferior. `anchor` é a posição do clique (para menus).
   */
  onFkNavigate?: (mode: 'open' | 'peek', dir: 'out' | 'in', col: number, row: Cell[], anchor: { clientX: number; clientY: number }) => void
}

interface ColumnLayout {
  /** todas as colunas (índice na fonte) na ordem de exibição */
  order: number[]
  hidden: Set<number>
}

function defaultLayout(fields: FieldInfo[]): ColumnLayout {
  return { order: fields.map((_, i) => i), hidden: new Set() }
}

/** layout salvo por nome de coluna, para sobreviver a colunas novas/removidas */
function loadLayout(key: string | undefined, fields: FieldInfo[]): ColumnLayout {
  if (!key) return defaultLayout(fields)
  try {
    const saved = JSON.parse(localStorage.getItem(`nexo-cols:${key}`) ?? 'null') as { order: string[]; hidden: string[] } | null
    if (!saved) return defaultLayout(fields)
    const byName = new Map(fields.map((f, i) => [f.name, i]))
    const order = saved.order.map((n) => byName.get(n)).filter((i): i is number => i !== undefined)
    for (let i = 0; i < fields.length; i++) if (!order.includes(i)) order.push(i)
    const hidden = new Set(saved.hidden.map((n) => byName.get(n)).filter((i): i is number => i !== undefined))
    if (hidden.size >= order.length) hidden.clear()
    return { order, hidden }
  } catch {
    return defaultLayout(fields)
  }
}

function saveLayout(key: string | undefined, fields: FieldInfo[], layout: ColumnLayout): void {
  if (!key) return
  const isDefault = !layout.hidden.size && layout.order.every((c, i) => c === i)
  if (isDefault) localStorage.removeItem(`nexo-cols:${key}`)
  else
    localStorage.setItem(
      `nexo-cols:${key}`,
      JSON.stringify({ order: layout.order.map((c) => fields[c].name), hidden: [...layout.hidden].map((c) => fields[c].name) })
    )
}

interface Rect {
  r0: number
  c0: number
  r1: number
  c1: number
}

function normalize(s: Rect): Rect {
  return { r0: Math.min(s.r0, s.r1), r1: Math.max(s.r0, s.r1), c0: Math.min(s.c0, s.c1), c1: Math.max(s.c0, s.c1) }
}

function estimateWidths(fields: FieldInfo[], rows: Cell[][]): number[] {
  return fields.map((f, i) => {
    let max = Math.max(f.name.length + 2, f.typeName.length) * 7.6 + 34
    const sample = Math.min(rows.length, 60)
    for (let r = 0; r < sample; r++) {
      const v = rows[r][i]
      if (v != null) max = Math.max(max, Math.min(v.length, 60) * 7.6 + 24)
    }
    return Math.round(Math.min(Math.max(max, 72), 380))
  })
}

function compare(a: Cell, b: Cell, numeric: boolean): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  if (numeric) return Number(a) - Number(b)
  return a.localeCompare(b, undefined, { numeric: true })
}

function tsvCell(v: Cell): string {
  if (v === null) return ''
  return /[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function sqlLiteral(v: Cell): string {
  return v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`
}

export const DataGrid = memo(function DataGrid({
  fields,
  rows,
  rowOffset = 0,
  sort,
  onSort,
  editable,
  pkColumns = [],
  edits,
  onEdit,
  onDeleteRows,
  onRevertRows,
  tableName,
  emptyText = 'Nenhuma linha',
  layoutKey,
  onVisibleColumnsChange,
  fkColumns,
  refColumns,
  onFkNavigate
}: DataGridProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const [widths, setWidths] = useState<number[]>(() => estimateWidths(fields, rows))
  const [localSort, setLocalSort] = useState<{ col: number; dir: 'asc' | 'desc' } | null>(null)
  const [sel, setSel] = useState<Rect | null>(null)
  const [editing, setEditing] = useState<{ r: number; c: number; value: string; typed?: boolean } | null>(null)
  const [viewer, setViewer] = useState<{ title: string; value: Cell; type: string } | null>(null)
  const [layout, setLayoutState] = useState<ColumnLayout>(() => loadLayout(layoutKey, fields))
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [drag, setDrag] = useState<{ from: number; x: number; insertAt: number; edge: number } | null>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const dragMoved = useRef(false)
  const [ctrlHeld, setCtrlHeld] = useState(false)

  // Ctrl/Cmd pressionado: células FK viram "links"
  useEffect(() => {
    if (!fkColumns?.size && !refColumns?.size) return
    const sync = (e: KeyboardEvent | MouseEvent): void => setCtrlHeld(e.ctrlKey || e.metaKey)
    const reset = (): void => setCtrlHeld(false)
    window.addEventListener('keydown', sync)
    window.addEventListener('keyup', sync)
    window.addEventListener('mousemove', sync)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', sync)
      window.removeEventListener('keyup', sync)
      window.removeEventListener('mousemove', sync)
      window.removeEventListener('blur', reset)
    }
  }, [fkColumns, refColumns])

  const fieldsKey = fields.map((f) => f.name).join('\u0000')
  useEffect(() => {
    setWidths(estimateWidths(fields, rows))
    setLayoutState(loadLayout(layoutKey, fields))
    setLocalSort(null)
    setSel(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldsKey, layoutKey])

  const setLayout = useCallback(
    (next: ColumnLayout) => {
      setLayoutState(next)
      saveLayout(layoutKey, fields, next)
      setSel(null)
    },
    [layoutKey, fields]
  )

  /** posição de exibição → índice da coluna na fonte */
  const cols = useMemo(() => layout.order.filter((c) => !layout.hidden.has(c) && c < fields.length), [layout, fields.length])

  useEffect(() => {
    onVisibleColumnsChange?.(cols)
  }, [cols, onVisibleColumnsChange])

  // índice visual → índice na fonte
  const order = useMemo(() => {
    const idx = rows.map((_, i) => i)
    if (!onSort && localSort) {
      const numeric = isNumericType(fields[localSort.col]?.typeName ?? '')
      const dir = localSort.dir === 'asc' ? 1 : -1
      idx.sort((a, b) => compare(rows[a][localSort.col], rows[b][localSort.col], numeric) * dir)
    }
    return idx
  }, [rows, localSort, onSort, fields])

  const offsets = useMemo(() => {
    const o: number[] = []
    let x = GUTTER_W
    for (const c of cols) {
      o.push(x)
      x += widths[c] ?? 120
    }
    return { left: o, total: x }
  }, [widths, cols])

  const virtualizer = useVirtualizer({
    count: order.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_H,
    overscan: 16
  })

  const valueAt = useCallback(
    (src: number, col: number): Cell => {
      const edited = edits?.cells.get(src)
      if (edited?.has(col)) return edited.get(col)!
      return rows[src]?.[col] ?? null
    },
    [rows, edits]
  )

  const rowValues = (src: number): Cell[] => fields.map((_, i) => valueAt(src, i))

  const scrollToCell = (r: number, c: number): void => {
    virtualizer.scrollToIndex(r, { align: 'auto' })
    const el = scroller.current
    if (!el) return
    const left = offsets.left[c]
    const right = left + widths[cols[c]]
    if (left - GUTTER_W < el.scrollLeft) el.scrollLeft = left - GUTTER_W
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth
  }

  const copySelection = useCallback(
    (mode: 'tsv' | 'json' | 'insert' = 'tsv', withHeader = false) => {
      if (!sel) return
      const s = normalize(sel)
      const srcCols = cols.slice(s.c0, s.c1 + 1)
      const selFields = srcCols.map((c) => fields[c])
      const lines: string[] = []
      if (mode === 'json') {
        const objs = []
        for (let r = s.r0; r <= s.r1; r++) {
          objs.push(Object.fromEntries(selFields.map((f, i) => [f.name, valueAt(order[r], srcCols[i])])))
        }
        window.api.copy(JSON.stringify(objs.length === 1 ? objs[0] : objs, null, 2))
        return
      }
      if (mode === 'insert') {
        const names = selFields.map((f) => `"${f.name.replace(/"/g, '""')}"`).join(', ')
        for (let r = s.r0; r <= s.r1; r++) {
          const vals = srcCols.map((c) => sqlLiteral(valueAt(order[r], c))).join(', ')
          lines.push(`INSERT INTO ${tableName ?? 'tabela'} (${names}) VALUES (${vals});`)
        }
        window.api.copy(lines.join('\n'))
        return
      }
      if (withHeader) lines.push(selFields.map((f) => f.name).join('\t'))
      for (let r = s.r0; r <= s.r1; r++) {
        lines.push(srcCols.map((c) => tsvCell(valueAt(order[r], c))).join('\t'))
      }
      // célula única: copia o valor cru
      window.api.copy(s.r0 === s.r1 && s.c0 === s.c1 ? (valueAt(order[s.r0], srcCols[0]) ?? '') : lines.join('\n'))
    },
    [sel, fields, cols, order, valueAt, tableName]
  )

  const selectedSourceRows = (): number[] => {
    if (!sel) return []
    const s = normalize(sel)
    const out: number[] = []
    for (let r = s.r0; r <= s.r1; r++) out.push(order[r])
    return out
  }

  const startEdit = (r: number, c: number): void => {
    const col = cols[c]
    if (!editable) {
      setViewer({ title: fields[col].name, value: valueAt(order[r], col), type: fields[col].typeName })
      return
    }
    const v = valueAt(order[r], col)
    setEditing({ r, c, value: v ?? '' })
  }

  const commitEdit = (value: Cell): void => {
    if (!editing) return
    const src = order[editing.r]
    const col = cols[editing.c]
    if (value !== valueAt(src, col)) onEdit?.(src, col, value)
    setEditing(null)
    scroller.current?.focus()
  }

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (editing) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault()
      copySelection('tsv', e.shiftKey)
      return
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setSel({ r0: 0, c0: 0, r1: order.length - 1, c1: cols.length - 1 })
      return
    }
    if (!sel) return
    const move = (dr: number, dc: number): void => {
      e.preventDefault()
      const r = Math.max(0, Math.min(order.length - 1, sel.r1 + dr))
      const c = Math.max(0, Math.min(cols.length - 1, sel.c1 + dc))
      setSel(e.shiftKey ? { ...sel, r1: r, c1: c } : { r0: r, c0: c, r1: r, c1: c })
      scrollToCell(r, c)
    }
    const page = Math.max(1, Math.floor((scroller.current?.clientHeight ?? 300) / ROW_H) - 2)
    switch (e.key) {
      case 'ArrowDown':
        return move(1, 0)
      case 'ArrowUp':
        return move(-1, 0)
      case 'ArrowLeft':
        return move(0, -1)
      case 'ArrowRight':
        return move(0, 1)
      case 'Tab':
        return move(0, e.shiftKey ? -1 : 1)
      case 'PageDown':
        return move(page, 0)
      case 'PageUp':
        return move(-page, 0)
      case 'Home':
        return mod ? move(-order.length, 0) : move(0, -cols.length)
      case 'End':
        return mod ? move(order.length, 0) : move(0, cols.length)
      case 'Enter':
      case 'F2':
        e.preventDefault()
        startEdit(sel.r1, sel.c1)
        return
      case 'Delete':
        if (editable) {
          e.preventDefault()
          onDeleteRows?.(selectedSourceRows())
        }
        return
      default:
        if (editable && e.key.length === 1 && !mod && !e.altKey) {
          e.preventDefault()
          setEditing({ r: sel.r1, c: sel.c1, value: e.key, typed: true })
        }
    }
  }

  const onCellMouseDown = (e: React.MouseEvent, r: number, c: number): void => {
    const col = cols[c]
    if (e.button === 0 && (e.ctrlKey || e.metaKey) && valueAt(order[r], col) !== null) {
      // Ctrl+clique: prioriza seguir a FK; numa coluna só referenciada, abre quem aponta para ela
      const dir = fkColumns?.has(col) ? 'out' : refColumns?.has(col) ? 'in' : null
      if (dir) {
        e.preventDefault()
        onFkNavigate?.('open', dir, col, rowValues(order[r]), e)
        return
      }
    }
    if (e.button === 2 && sel) {
      const s = normalize(sel)
      if (r >= s.r0 && r <= s.r1 && c >= s.c0 && c <= s.c1) return
    }
    if (e.shiftKey && sel) setSel({ ...sel, r1: r, c1: c })
    else setSel({ r0: r, c0: c, r1: r, c1: c })
  }

  const onGutterMouseDown = (e: React.MouseEvent, r: number): void => {
    const last = cols.length - 1
    if (e.button === 2 && sel) {
      const s = normalize(sel)
      if (r >= s.r0 && r <= s.r1) return
    }
    if (e.shiftKey && sel) setSel({ r0: sel.r0, c0: 0, r1: r, c1: last })
    else setSel({ r0: r, c0: 0, r1: r, c1: last })
  }

  const cellMenu = (e: React.MouseEvent, r: number, c: number): void => {
    const src = order[r]
    const col = cols[c]
    const rowsSel = selectedSourceRows()
    const isDeleted = rowsSel.some((x) => edits?.deleted.has(x))
    const isEdited = rowsSel.some((x) => edits?.cells.has(x) || edits?.deleted.has(x))
    const fkTarget = fkColumns?.get(col)
    const refs = refColumns?.get(col)
    const items: MenuEntry[] = []
    const hasValue = valueAt(src, col) !== null
    if (fkTarget && hasValue) {
      items.push(
        { label: `Ver ${fkTarget} abaixo`, icon: <CornerRightDown />, onSelect: () => onFkNavigate?.('peek', 'out', col, rowValues(src), e) },
        { label: `Abrir ${fkTarget}`, icon: <ExternalLink />, shortcut: 'Ctrl+clique', onSelect: () => onFkNavigate?.('open', 'out', col, rowValues(src), e) }
      )
    }
    if (refs && hasValue) {
      items.push({
        label: refs.length > 1 ? `Ver registros que referenciam (${refs.length} tabelas)` : `Ver registros de ${refs[0]}`,
        icon: <CornerLeftDown />,
        onSelect: () => onFkNavigate?.('peek', 'in', col, rowValues(src), e)
      })
    }
    if (items.length) items.push('separator')
    items.push(
      { label: 'Copiar', icon: <Copy />, shortcut: 'Ctrl+C', onSelect: () => copySelection('tsv') },
      { label: 'Copiar com cabeçalho', icon: <ClipboardCopy />, shortcut: 'Ctrl+⇧+C', onSelect: () => copySelection('tsv', true) },
      { label: 'Copiar como JSON', icon: <FileJson />, onSelect: () => copySelection('json') },
      { label: 'Copiar como INSERT', icon: <ClipboardCopy />, onSelect: () => copySelection('insert') },
      'separator',
      {
        label: 'Ver valor',
        icon: <Eye />,
        onSelect: () => setViewer({ title: fields[col].name, value: valueAt(src, col), type: fields[col].typeName })
      }
    )
    if (editable) {
      items.push(
        'separator',
        { label: 'Definir como NULL', icon: <Eraser />, onSelect: () => onEdit?.(src, col, null) },
        { label: 'Desfazer alterações', icon: <Undo2 />, disabled: !isEdited, onSelect: () => onRevertRows?.(rowsSel) },
        {
          label: rowsSel.length > 1 ? `Excluir ${rowsSel.length} linhas` : 'Excluir linha',
          icon: <Trash2 />,
          danger: true,
          disabled: isDeleted,
          shortcut: 'Del',
          onSelect: () => onDeleteRows?.(rowsSel)
        }
      )
    }
    showContextMenu(e, items)
  }

  const startResize = (e: React.MouseEvent, col: number): void => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = widths[col]
    const onMove = (ev: MouseEvent): void => {
      setWidths((w) => w.map((x, i) => (i === col ? Math.max(48, startW + ev.clientX - startX) : x)))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /** arrastar cabeçalho para reordenar; um clique sem movimento continua ordenando */
  const startColumnDrag = (e: React.MouseEvent, displayIdx: number): void => {
    if (e.button !== 0) return
    const el = scroller.current
    if (!el) return
    const startX = e.clientX
    dragMoved.current = false
    let insertAt = displayIdx

    const onMove = (ev: MouseEvent): void => {
      if (!dragMoved.current && Math.abs(ev.clientX - startX) < 5) return
      dragMoved.current = true
      document.body.style.cursor = 'grabbing'
      // rola sozinho perto das bordas
      const rect = el.getBoundingClientRect()
      if (ev.clientX < rect.left + GUTTER_W + 30) el.scrollLeft -= 18
      else if (ev.clientX > rect.right - 30) el.scrollLeft += 18
      // mede os cabeçalhos reais no DOM: a posição de soltura sempre bate com o que está na tela
      const cells = [...(headerRef.current?.querySelectorAll<HTMLElement>('[data-col]') ?? [])]
      insertAt = cells.length
      let edge = cells.length ? cells[cells.length - 1].getBoundingClientRect().right : rect.left
      for (let i = 0; i < cells.length; i++) {
        const r = cells[i].getBoundingClientRect()
        if (ev.clientX < r.left + r.width / 2) {
          insertAt = i
          edge = r.left
          break
        }
      }
      const toContent = (clientX: number): number => clientX - rect.left + el.scrollLeft
      setDrag({ from: displayIdx, x: toContent(ev.clientX), insertAt, edge: toContent(edge) })
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      setDrag(null)
      if (!dragMoved.current) return
      // o click (se houver) dispara logo após o mouseup; depois disso a flag não deve engolir cliques futuros
      setTimeout(() => (dragMoved.current = false), 0)
      if (insertAt === displayIdx || insertAt === displayIdx + 1) return
      // reordena as visíveis e reinsere as ocultas nas posições relativas originais
      const moved = cols[displayIdx]
      const visible = cols.filter((c) => c !== moved)
      visible.splice(insertAt > displayIdx ? insertAt - 1 : insertAt, 0, moved)
      let vi = 0
      const order = layout.order.map((c) => (layout.hidden.has(c) ? c : visible[vi++]))
      setLayout({ order, hidden: layout.hidden })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const headerClick = (col: number): void => {
    if (dragMoved.current) {
      dragMoved.current = false
      return
    }
    if (onSort) return onSort(fields[col].name)
    setLocalSort((s) =>
      s?.col !== col ? { col, dir: 'asc' } : s.dir === 'asc' ? { col, dir: 'desc' } : null
    )
  }

  const sortDirFor = (col: number): 'asc' | 'desc' | null => {
    if (onSort) return sort?.column === fields[col].name ? sort.dir : null
    return localSort?.col === col ? localSort.dir : null
  }

  const hideColumn = (col: number): void => {
    if (cols.length <= 1) return
    setLayout({ order: layout.order, hidden: new Set([...layout.hidden, col]) })
  }

  const headerMenu = (e: React.MouseEvent, col: number): void => {
    showContextMenu(e, [
      { label: 'Ocultar coluna', icon: <EyeOff />, disabled: cols.length <= 1, onSelect: () => hideColumn(col) },
      {
        label: 'Mostrar somente esta',
        icon: <Eye />,
        onSelect: () => setLayout({ order: layout.order, hidden: new Set(layout.order.filter((c) => c !== col)) })
      },
      { label: 'Escolher colunas…', icon: <Columns3 />, onSelect: () => setColumnsOpen(true) },
      'separator',
      {
        label: 'Copiar nome',
        icon: <Copy />,
        onSelect: () => window.api.copy(fields[col].name)
      },
      {
        label: 'Restaurar colunas',
        icon: <RotateCcw />,
        disabled: !layout.hidden.size && layout.order.every((c, i) => c === i),
        onSelect: () => setLayout(defaultLayout(fields))
      }
    ])
  }

  const norm = sel ? normalize(sel) : null
  const items = virtualizer.getVirtualItems()

  return (
    <div className="relative h-full min-h-0">
      <div
        ref={scroller}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="h-full overflow-auto outline-none"
      >
        <div style={{ width: offsets.total, height: virtualizer.getTotalSize() + HEADER_H, position: 'relative' }}>
          {/* cabeçalho */}
          <div
            ref={headerRef}
            className="sticky top-0 z-20 flex border-b border-line-strong bg-panel/95 backdrop-blur"
            style={{ width: offsets.total, height: HEADER_H }}
          >
            <button
              onClick={() => setColumnsOpen((o) => !o)}
              onMouseDown={(e) => e.stopPropagation()}
              title="Escolher e reordenar colunas"
              className={cn(
                'sticky left-0 z-10 flex shrink-0 items-center justify-center gap-1 border-r border-line bg-panel transition-colors hover:text-fg',
                layout.hidden.size || columnsOpen ? 'text-accent' : 'text-faint'
              )}
              style={{ width: GUTTER_W }}
            >
              <Columns3 className="size-3.5" />
              {layout.hidden.size > 0 && <span className="text-[10px] font-semibold tabular-nums">{cols.length}</span>}
            </button>
            {cols.map((col, c) => {
              const f = fields[col]
              const dir = sortDirFor(col)
              const isPk = pkColumns.includes(f.name)
              return (
                <div
                  key={col}
                  data-col={col}
                  onMouseDown={(e) => startColumnDrag(e, c)}
                  onClick={() => headerClick(col)}
                  onContextMenu={(e) => headerMenu(e, col)}
                  className={cn(
                    'group relative flex shrink-0 cursor-default flex-col justify-center border-r border-line px-2.5 transition-colors hover:bg-hover',
                    norm && c >= norm.c0 && c <= norm.c1 && 'bg-accent/[0.06]',
                    drag?.from === c && 'opacity-40'
                  )}
                  style={{ width: widths[col] }}
                  title={`${f.name} · ${f.typeName}\nArraste para mover · botão direito para opções`}
                >
                  <div className="flex items-center gap-1 leading-tight">
                    {isPk && <KeyRound className="size-3 shrink-0 text-warn" />}
                    {fkColumns?.has(col) && (
                      <span title={`FK → ${fkColumns.get(col)}`} className="shrink-0">
                        <Link2 className="size-3 text-violet" />
                      </span>
                    )}
                    {refColumns?.has(col) && (
                      <span title={`Referenciada por:\n${refColumns.get(col)!.join('\n')}`} className="shrink-0">
                        <CornerLeftDown className="size-3 text-cyan" />
                      </span>
                    )}
                    <span className="truncate text-[12px] font-semibold text-fg">{f.name}</span>
                    {dir && (dir === 'asc' ? <ArrowUp className="size-3 shrink-0 text-accent" /> : <ArrowDown className="size-3 shrink-0 text-accent" />)}
                  </div>
                  <span className="truncate font-mono text-[10px] leading-tight text-faint">{f.typeName}</span>
                  <div
                    onMouseDown={(e) => startResize(e, col)}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={() =>
                      setWidths((w) => w.map((x, i) => (i === col ? estimateWidths([f], rows.map((r) => [r[col]]))[0] : x)))
                    }
                    className="absolute top-0 right-[-3px] z-10 h-full w-[6px] cursor-col-resize hover:bg-accent/60"
                  />
                </div>
              )
            })}
          </div>

          {/* arrasto de coluna: fantasma + indicador de posição */}
          {drag && (
            <>
              <div
                className="pointer-events-none absolute z-30 flex flex-col justify-center rounded-md border border-accent/60 bg-elev-2 px-2.5 shadow-[0_12px_32px_-8px_#000000d0]"
                style={{
                  height: HEADER_H,
                  width: widths[cols[drag.from]],
                  transform: `translateX(${drag.x - widths[cols[drag.from]] / 2}px)`,
                  top: (scroller.current?.scrollTop ?? 0)
                }}
              >
                <span className="truncate text-[12px] font-semibold">{fields[cols[drag.from]].name}</span>
                <span className="truncate font-mono text-[10px] text-faint">{fields[cols[drag.from]].typeName}</span>
              </div>
              <div
                className="pointer-events-none absolute z-30 w-[2px] rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)] transition-[left] duration-100 ease-out"
                style={{
                  left: drag.edge - 1,
                  top: scroller.current?.scrollTop ?? 0,
                  height: Math.min(scroller.current?.clientHeight ?? 0, virtualizer.getTotalSize() + HEADER_H)
                }}
              />
            </>
          )}

          {/* linhas */}
          {items.map((vr) => {
            const r = vr.index
            const src = order[r]
            const deleted = edits?.deleted.has(src)
            const inserted = edits && src >= edits.insertedFrom
            const rowEdits = edits?.cells.get(src)
            const rowSelected = norm && r >= norm.r0 && r <= norm.r1
            return (
              <div
                key={vr.key}
                className={cn(
                  'absolute left-0 flex',
                  r % 2 === 1 && 'bg-white/[0.012]',
                  deleted && 'bg-err/[0.08] line-through decoration-err/60',
                  inserted && 'bg-ok/[0.06]'
                )}
                style={{ top: 0, transform: `translateY(${vr.start + HEADER_H}px)`, height: ROW_H, width: offsets.total }}
              >
                <div
                  onMouseDown={(e) => onGutterMouseDown(e, r)}
                  onContextMenu={(e) => cellMenu(e, r, norm?.c0 ?? 0)}
                  className={cn(
                    'sticky left-0 z-10 flex shrink-0 items-center justify-end border-r border-line bg-panel pr-2 font-mono text-[11px] tabular-nums text-faint',
                    rowSelected && 'text-accent'
                  )}
                  style={{ width: GUTTER_W }}
                >
                  {inserted ? <span className="text-ok">+</span> : rowOffset + src + 1}
                </div>
                {cols.map((col, c) => {
                  const f = fields[col]
                  const edited = rowEdits?.has(col)
                  const v = edited ? rowEdits!.get(col)! : rows[src][col]
                  const inSel = norm && r >= norm.r0 && r <= norm.r1 && c >= norm.c0 && c <= norm.c1
                  const isFocus = sel && sel.r1 === r && sel.c1 === c
                  const fkLink = fkColumns?.has(col) && v !== null
                  const refLink = refColumns?.has(col) && v !== null
                  const linkTitle = (what: string): string => `${what} · Ctrl+clique abre em aba`
                  return (
                    <div
                      key={col}
                      onMouseDown={(e) => onCellMouseDown(e, r, c)}
                      onDoubleClick={() => startEdit(r, c)}
                      onContextMenu={(e) => cellMenu(e, r, c)}
                      className={cn(
                        'grid-cell group/cell relative shrink-0',
                        isNumericType(f.typeName) && 'text-right tabular-nums',
                        (fkLink || refLink) && 'pr-7',
                        fkLink && refLink && 'pr-12',
                        (fkLink || refLink) && ctrlHeld && 'cursor-pointer text-accent underline decoration-accent/50 underline-offset-2',
                        inSel && 'bg-accent/[0.13]',
                        isFocus && 'shadow-[inset_0_0_0_1.5px_var(--color-accent)]',
                        edited && 'bg-warn/[0.12] text-warn'
                      )}
                      style={{ width: widths[col] }}
                    >
                      <CellValue v={v} type={f.typeName} />
                      {(fkLink || refLink) && (
                        <span className="absolute top-1/2 right-1 flex -translate-y-1/2 gap-0.5">
                          {refLink && (
                            <CellArrow
                              title={linkTitle(
                                refColumns!.get(col)!.length > 1
                                  ? `Ver registros que referenciam (${refColumns!.get(col)!.join(', ')})`
                                  : `Ver registros de ${refColumns!.get(col)![0]}`
                              )}
                              tone="in"
                              onClick={(e) => {
                                setSel({ r0: r, c0: c, r1: r, c1: c })
                                onFkNavigate?.(e.ctrlKey || e.metaKey ? 'open' : 'peek', 'in', col, rowValues(src), e)
                              }}
                            />
                          )}
                          {fkLink && (
                            <CellArrow
                              title={linkTitle(`Ver ${fkColumns!.get(col)} abaixo`)}
                              tone="out"
                              onClick={(e) => {
                                setSel({ r0: r, c0: c, r1: r, c1: c })
                                onFkNavigate?.(e.ctrlKey || e.metaKey ? 'open' : 'peek', 'out', col, rowValues(src), e)
                              }}
                            />
                          )}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}

          {editing && (
            <CellEditor
              key={`${editing.r}:${editing.c}`}
              initial={editing.value}
              selectAll={!editing.typed}
              style={{
                top: editing.r * ROW_H + HEADER_H,
                left: offsets.left[editing.c],
                width: Math.max(widths[cols[editing.c]], 180),
                height: ROW_H
              }}
              onCommit={commitEdit}
              onCancel={() => {
                setEditing(null)
                scroller.current?.focus()
              }}
            />
          )}
        </div>
        {!rows.length && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center pt-8 text-[12.5px] text-faint">
            {emptyText}
          </div>
        )}
      </div>
      {columnsOpen && (
        <ColumnsMenu
          fields={fields}
          order={layout.order}
          hidden={layout.hidden}
          pkColumns={pkColumns}
          onChange={(order, hidden) => setLayout({ order, hidden })}
          onReset={() => setLayout(defaultLayout(fields))}
          onClose={() => setColumnsOpen(false)}
        />
      )}
      <ValueViewer
        open={!!viewer}
        title={viewer?.title ?? ''}
        type={viewer?.type ?? ''}
        value={viewer?.value ?? null}
        onClose={() => setViewer(null)}
      />
    </div>
  )
})

function CellArrow({ title, tone, onClick }: { title: string; tone: 'in' | 'out'; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      title={title}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClick(e)
      }}
      className={cn(
        'flex size-5 items-center justify-center rounded opacity-35 transition-all group-hover/cell:opacity-100',
        tone === 'out' ? 'text-violet hover:bg-violet/20' : 'text-cyan hover:bg-cyan/20'
      )}
    >
      {tone === 'out' ? <CornerRightDown className="size-3.5" /> : <CornerLeftDown className="size-3.5" />}
    </button>
  )
}

const CellValue = memo(function CellValue({ v, type }: { v: Cell; type: string }) {
  if (v === null) return <span className="text-[11.5px] text-faint italic">NULL</span>
  if (isBoolType(type)) {
    const on = v === 't' || v === 'true'
    return <span className={on ? 'text-ok' : 'text-err/80'}>{on ? 'true' : 'false'}</span>
  }
  const display = v.length > 400 ? `${v.slice(0, 400)}…` : v
  if (isJsonType(type)) return <span className="text-violet">{display}</span>
  if (v === '') return <span className="text-faint">''</span>
  return <>{display.replace(/\n/g, '↵ ')}</>
})

function CellEditor({
  initial,
  selectAll,
  style,
  onCommit,
  onCancel
}: {
  initial: string
  selectAll: boolean
  style: React.CSSProperties
  onCommit: (v: string | null) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    if (selectAll) ref.current?.select()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const finish = (v: string | null | undefined): void => {
    if (done.current) return
    done.current = true
    if (v === undefined) onCancel()
    else onCommit(v)
  }
  return (
    <input
      ref={ref}
      defaultValue={initial}
      className="absolute z-30 rounded-[3px] border-0 bg-elev-2 px-2.5 font-mono text-[12.5px] text-fg shadow-[0_0_0_2px_var(--color-accent),0_8px_24px_-6px_#000] outline-none"
      style={style}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(undefined)
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  )
}
