import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface DropdownOption<T> {
  value: T
  label: string
  icon?: ReactNode
  hint?: string
}

export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  placeholder,
  icon,
  onOpen,
  loading,
  width = 240,
  className,
  searchable
}: {
  value: T | null
  options: DropdownOption<T>[]
  onChange: (v: T) => void
  placeholder: string
  icon?: ReactNode
  onOpen?: () => void
  loading?: boolean
  width?: number
  className?: string
  searchable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        onClick={() => {
          if (!open) {
            onOpen?.()
            setQ('')
          }
          setOpen(!open)
        }}
        className={cn(
          'flex h-7 max-w-[220px] items-center gap-1.5 rounded-md px-2 text-[12.5px] transition-colors hover:bg-hover',
          open && 'bg-hover',
          current ? 'text-fg' : 'text-muted'
        )}
      >
        {current?.icon ?? icon}
        <span className="truncate">{current?.label ?? placeholder}</span>
        <ChevronDown className={cn('size-3 shrink-0 text-faint transition-transform duration-200', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -2, scale: 0.98, transition: { duration: 0.08 } }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className="absolute top-full left-0 z-40 mt-1 origin-top-left overflow-hidden rounded-xl border border-line-strong bg-[#141821f5] p-1 shadow-[0_16px_48px_-12px_#000000c0] backdrop-blur-xl"
            style={{ width }}
          >
            {searchable && (
              <div className="mb-1 flex items-center gap-2 border-b border-line px-2 pb-1.5 pt-1">
                <Search className="size-3.5 text-faint" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Filtrar…"
                  className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-faint"
                />
              </div>
            )}
            <div className="max-h-[300px] overflow-auto">
              {loading && <div className="px-2 py-2 text-[12px] text-faint">Carregando…</div>}
              {!loading && !filtered.length && <div className="px-2 py-2 text-[12px] text-faint">Nada encontrado</div>}
              {filtered.map((o) => (
                <button
                  key={o.value}
                  onClick={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                  className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] transition-colors hover:bg-accent/20"
                >
                  <span className="flex w-4 justify-center">{o.icon}</span>
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="text-[11px] text-faint">{o.hint}</span>}
                  {o.value === value && <Check className="size-3.5 text-accent" />}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
