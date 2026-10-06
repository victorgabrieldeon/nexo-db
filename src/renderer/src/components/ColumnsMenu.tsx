import { useEffect, useRef, useState } from 'react'
import { motion, Reorder, useDragControls } from 'motion/react'
import { Check, GripVertical, KeyRound, Search } from 'lucide-react'
import type { FieldInfo } from '@shared/types'
import { cn } from '@/lib/utils'

/** Painel para escolher quais colunas aparecem e em que ordem (arrastando). */
export function ColumnsMenu({
  fields,
  order,
  hidden,
  pkColumns,
  onChange,
  onReset,
  onClose
}: {
  fields: FieldInfo[]
  order: number[]
  hidden: Set<number>
  pkColumns: string[]
  onChange: (order: number[], hidden: Set<number>) => void
  onReset: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const term = q.trim().toLowerCase()
  const visibleCount = order.length - hidden.size

  const toggle = (c: number): void => {
    const next = new Set(hidden)
    if (next.has(c)) next.delete(c)
    else if (visibleCount > 1) next.add(c)
    onChange(order, next)
  }

  const setAll = (show: boolean): void => {
    if (show) return onChange(order, new Set())
    // "somente estas": esconde tudo que não bate com a busca
    const matches = order.filter((c) => fields[c].name.toLowerCase().includes(term))
    if (!matches.length) return
    onChange(order, new Set(order.filter((c) => !matches.includes(c))))
  }

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: -4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
      className="absolute top-[38px] left-1 z-40 flex max-h-[min(460px,calc(100%-48px))] w-[280px] origin-top-left flex-col overflow-hidden rounded-xl border border-line-strong bg-[#141821f5] shadow-[0_16px_48px_-12px_#000000c0] backdrop-blur-xl"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Search className="size-3.5 text-faint" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filtrar colunas…"
          className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-faint"
        />
        <span className="shrink-0 text-[11px] text-faint tabular-nums">
          {visibleCount}/{order.length}
        </span>
      </div>

      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5 text-[11.5px]">
        <MiniButton onClick={() => setAll(true)}>Mostrar todas</MiniButton>
        {term && <MiniButton onClick={() => setAll(false)}>Somente estas</MiniButton>}
        <div className="flex-1" />
        <MiniButton onClick={onReset}>Restaurar</MiniButton>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-1">
        {term ? (
          order
            .filter((c) => fields[c].name.toLowerCase().includes(term))
            .map((c) => (
              <Row key={c} field={fields[c]} checked={!hidden.has(c)} pk={pkColumns.includes(fields[c].name)} onToggle={() => toggle(c)} />
            ))
        ) : (
          <Reorder.Group axis="y" values={order} onReorder={(o) => onChange(o, hidden)} layoutScroll className="relative">
            {order.map((c) => (
              <DraggableRow
                key={c}
                value={c}
                field={fields[c]}
                checked={!hidden.has(c)}
                pk={pkColumns.includes(fields[c].name)}
                onToggle={() => toggle(c)}
              />
            ))}
          </Reorder.Group>
        )}
      </div>
      <div className="border-t border-line px-3 py-1.5 text-[11px] text-faint">Arraste para reordenar · também dá pelo cabeçalho</div>
    </motion.div>
  )
}

function MiniButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-md px-2 py-1 text-muted transition-colors hover:bg-hover hover:text-fg">
      {children}
    </button>
  )
}

function RowContent({ field, checked, pk, onToggle, handle }: { field: FieldInfo; checked: boolean; pk: boolean; onToggle: () => void; handle?: React.ReactNode }) {
  return (
    <div className="flex h-7 items-center gap-2 rounded-md pr-2 pl-1 text-[12.5px] transition-colors hover:bg-hover">
      {handle ?? <span className="w-4" />}
      <button
        onClick={onToggle}
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
          checked ? 'border-accent bg-accent text-white' : 'border-line-strong bg-bg'
        )}
      >
        {checked && <Check className="size-3" strokeWidth={3} />}
      </button>
      <span onClick={onToggle} className={cn('flex min-w-0 flex-1 items-center gap-1.5 truncate', !checked && 'text-faint')}>
        {pk && <KeyRound className="size-3 shrink-0 text-warn" />}
        <span className="truncate">{field.name}</span>
      </span>
      <span className="shrink-0 font-mono text-[10.5px] text-faint">{field.typeName}</span>
    </div>
  )
}

function Row(props: { field: FieldInfo; checked: boolean; pk: boolean; onToggle: () => void }) {
  return <RowContent {...props} />
}

function DraggableRow({ value, ...props }: { value: number; field: FieldInfo; checked: boolean; pk: boolean; onToggle: () => void }) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={value}
      dragListener={false}
      dragControls={controls}
      className="relative rounded-md bg-[#141821]"
      whileDrag={{ scale: 1.02, boxShadow: '0 10px 30px -8px #000000c0', zIndex: 10 }}
    >
      <RowContent
        {...props}
        handle={
          <span
            onPointerDown={(e) => controls.start(e)}
            className="flex w-4 shrink-0 cursor-grab touch-none items-center justify-center text-faint hover:text-fg active:cursor-grabbing"
          >
            <GripVertical className="size-3.5" />
          </span>
        }
      />
    </Reorder.Item>
  )
}
