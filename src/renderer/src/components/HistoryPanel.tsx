import { useEffect, useMemo, useState } from 'react'
import { Copy, Search, TerminalSquare, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { HistoryEntry } from '@shared/types'
import { useTabs } from '@/stores/tabs'
import { cn, formatDuration, timeAgo } from '@/lib/utils'
import { IconButton, showContextMenu } from './ui'

export function HistoryPanel() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [q, setQ] = useState('')
  const newQuery = useTabs((s) => s.newQuery)

  useEffect(() => {
    const load = (): void => void window.api.history.list().then(setEntries)
    load()
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [])

  const filtered = useMemo(() => {
    const term = q.toLowerCase()
    return term ? entries.filter((e) => e.sql.toLowerCase().includes(term)) : entries
  }, [entries, q])

  const open = (e: HistoryEntry): void => {
    newQuery({ connId: e.connectionId, database: e.database, sql: e.sql })
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5 px-2 pt-2 pb-1.5">
        <div className="flex h-7 flex-1 items-center gap-2 rounded-lg bg-bg px-2 ring-1 ring-line transition-shadow focus-within:ring-accent">
          <Search className="size-3.5 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar no histórico"
            className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-faint"
          />
        </div>
        <IconButton
          title="Limpar histórico"
          onClick={async () => {
            if (!confirm('Limpar todo o histórico de consultas?')) return
            await window.api.history.clear()
            setEntries([])
          }}
        >
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-3">
        {!filtered.length && <div className="px-3 py-6 text-center text-[12px] text-faint">Nada por aqui ainda</div>}
        {filtered.map((e) => (
          <div
            key={e.id}
            onDoubleClick={() => open(e)}
            onContextMenu={(ev) =>
              showContextMenu(ev, [
                { label: 'Abrir em nova consulta', icon: <TerminalSquare />, onSelect: () => open(e) },
                {
                  label: 'Copiar SQL',
                  icon: <Copy />,
                  onSelect: () => {
                    window.api.copy(e.sql)
                    toast.success('SQL copiado')
                  }
                }
              ])
            }
            className="group mb-0.5 cursor-default rounded-lg px-2.5 py-2 transition-colors hover:bg-hover"
            title="Duplo clique para abrir"
          >
            <div className="line-clamp-3 font-mono text-[11.5px] leading-relaxed break-all text-fg/90">{e.sql}</div>
            <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-faint">
              <span className={cn('size-1.5 rounded-full', e.ok ? 'bg-ok' : 'bg-err')} />
              <span className="truncate">
                {e.connectionName} · {e.database}
              </span>
              <span className="ml-auto shrink-0">
                {e.ok && `${formatDuration(e.durationMs)} · `}
                {timeAgo(e.at)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
