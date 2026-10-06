import { AnimatePresence, motion } from 'motion/react'
import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'ghost' | 'subtle' | 'danger'

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-white shadow-[0_1px_0_#ffffff30_inset,0_4px_14px_-4px_#6d8cff99] hover:brightness-110 active:brightness-95',
  ghost: 'text-muted hover:text-fg hover:bg-hover',
  subtle: 'bg-elev-2 text-fg border border-line-strong hover:bg-hover',
  danger: 'bg-err/15 text-err hover:bg-err/25'
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }
>(function Button({ variant = 'subtle', size = 'md', loading, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-all duration-150 disabled:pointer-events-none disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3.5 text-[13px]',
        variants[variant],
        className
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </button>
  )
})

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; size?: 'sm' | 'md' }
>(function IconButton({ className, active, size = 'md', ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'size-6' : 'size-7',
        active && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
        className
      )}
      {...rest}
    />
  )
})

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line-strong bg-elev-2 px-1 font-sans text-[10.5px] font-medium text-muted',
        className
      )}
    >
      {children}
    </kbd>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-muted', className)} />
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  width = 520,
  icon
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  width?: number
  icon?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" onMouseDown={onClose} />
          <motion.div
            role="dialog"
            className="relative flex max-h-full flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-[0_30px_80px_-20px_#000000d0,0_0_0_1px_#ffffff08_inset]"
            style={{ width }}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
            <div className="flex items-start gap-3 px-5 pt-5 pb-3">
              {icon && (
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  {icon}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
                {description && <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>}
              </div>
              <IconButton onClick={onClose} aria-label="Fechar">
                <X className="size-4" />
              </IconButton>
            </div>
            <div className="min-h-0 overflow-auto">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export interface MenuItem {
  label: string
  icon?: ReactNode
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}
export type MenuEntry = MenuItem | 'separator'

interface MenuState {
  x: number
  y: number
  items: MenuEntry[]
}

let openMenuFn: ((s: MenuState) => void) | null = null

/** Abre um menu de contexto na posição do evento. */
export function showContextMenu(e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuEntry[]): void {
  e.preventDefault()
  openMenuFn?.({ x: e.clientX, y: e.clientY, items })
}

export function ContextMenuHost() {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  useEffect(() => {
    openMenuFn = setMenu
    return () => {
      openMenuFn = null
    }
  }, [])

  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 8),
      y: Math.min(menu.y, window.innerHeight - r.height - 8)
    })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    // registra no próximo tick: se o menu foi aberto num mousedown, esse mesmo evento ainda
    // está propagando e chegaria ao window, fechando o menu na hora
    const t = setTimeout(() => {
      window.addEventListener('mousedown', close)
      window.addEventListener('wheel', close)
    }, 0)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', close)
    }
  }, [menu])

  return createPortal(
    <AnimatePresence>
      {menu && (
        <motion.div
          ref={ref}
          key={`${menu.x}-${menu.y}`}
          className="fixed z-[60] min-w-[200px] rounded-xl border border-line-strong bg-[#141821f2] p-1 shadow-[0_16px_48px_-12px_#000000c0] backdrop-blur-xl"
          style={{ left: pos.x, top: pos.y }}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.08 } }}
          transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {menu.items.map((item, i) =>
            item === 'separator' ? (
              <div key={i} className="mx-2 my-1 h-px bg-line-strong" />
            ) : (
              <button
                key={i}
                disabled={item.disabled}
                className={cn(
                  'flex h-7 w-full items-center gap-2.5 rounded-md px-2 text-left text-[12.5px] transition-colors disabled:opacity-40',
                  item.danger ? 'text-err hover:bg-err/15' : 'text-fg hover:bg-accent/20'
                )}
                onClick={() => {
                  setMenu(null)
                  item.onSelect()
                }}
              >
                <span className="flex size-4 items-center justify-center text-muted [&>svg]:size-3.5">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {item.shortcut && <span className="text-[11px] text-faint">{item.shortcut}</span>}
              </button>
            )
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  layoutId
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  layoutId: string
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-bg p-0.5 ring-1 ring-line-strong">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'relative flex h-6 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors',
            value === o.value ? 'text-fg' : 'text-muted hover:text-fg'
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={layoutId}
              className="absolute inset-0 rounded-md bg-elev-2 shadow-[0_1px_0_#ffffff10_inset,0_1px_3px_#00000060]"
              transition={{ type: 'spring', stiffness: 500, damping: 38 }}
            />
          )}
          <span className="relative flex items-center gap-1.5">{o.label}</span>
        </button>
      ))}
    </div>
  )
}
