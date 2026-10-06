import { useState } from 'react'
import { motion } from 'motion/react'
import { AlertTriangle, CheckCircle2, Clock, Download, FileJson, FileSpreadsheet, FileCode2, Info, Rows3, TerminalSquare, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { QueryError, QueryResult } from '@shared/types'
import { cn, errorMessage, formatCount, formatDuration } from '@/lib/utils'
import { FkGrid } from './FkGrid'
import { IconButton, showContextMenu } from './ui'

export interface ResultEntry {
  id: string
  sql: string
  result: QueryResult
  connId: string
  database: string
}

export interface LogEntry {
  id: string
  at: number
  sql: string
  kind: 'ok' | 'error' | 'notice'
  text: string
  durationMs?: number
  error?: QueryError
}

export function describeResult(r: QueryResult): string {
  if (r.fields.length) {
    return r.truncated ? `${formatCount(r.rows.length)}+ linhas` : `${formatCount(r.rows.length)} ${r.rows.length === 1 ? 'linha' : 'linhas'}`
  }
  const n = r.rowCount ?? 0
  switch (r.command) {
    case 'INSERT':
      return `${formatCount(n)} ${n === 1 ? 'linha inserida' : 'linhas inseridas'}`
    case 'UPDATE':
      return `${formatCount(n)} ${n === 1 ? 'linha atualizada' : 'linhas atualizadas'}`
    case 'DELETE':
      return `${formatCount(n)} ${n === 1 ? 'linha excluída' : 'linhas excluídas'}`
    default:
      return r.command ? `${r.command} executado` : 'Comando executado'
  }
}

/** mantém só as colunas visíveis no grid, na ordem exibida */
export function projectResult(r: QueryResult, cols: number[] | null): QueryResult {
  if (!cols || (cols.length === r.fields.length && cols.every((c, i) => c === i))) return r
  return { ...r, fields: cols.map((c) => r.fields[c]), rows: r.rows.map((row) => cols.map((c) => row[c])) }
}

export async function exportRows(format: 'csv' | 'json' | 'sql', result: QueryResult, name: string, tableName?: string): Promise<void> {
  try {
    const path = await window.api.exportResult({
      format,
      fields: result.fields.map((f) => f.name),
      rows: result.rows,
      suggestedName: name,
      tableName
    })
    if (path) toast.success('Exportado', { description: path })
  } catch (e) {
    toast.error('Falha ao exportar', { description: errorMessage(e) })
  }
}

export function ExportButton({ result, name, tableName }: { result: QueryResult; name: string; tableName?: string }) {
  return (
    <IconButton
      title="Exportar"
      onClick={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        showContextMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault: () => {} }, [
          { label: 'Exportar CSV', icon: <FileSpreadsheet />, onSelect: () => exportRows('csv', result, name) },
          { label: 'Exportar JSON', icon: <FileJson />, onSelect: () => exportRows('json', result, name) },
          { label: 'Exportar INSERTs SQL', icon: <FileCode2 />, onSelect: () => exportRows('sql', result, name, tableName) }
        ])
      }}
    >
      <Download className="size-3.5" />
    </IconButton>
  )
}

export function ResultsPanel({
  results,
  log,
  active,
  onActive,
  running,
  elapsed,
  maxRows
}: {
  results: ResultEntry[]
  log: LogEntry[]
  active: string
  onActive: (id: string) => void
  running: boolean
  elapsed: number
  maxRows: number
}) {
  const current = results.find((r) => r.id === active)
  const [visibleCols, setVisibleCols] = useState<number[] | null>(null)
  const errors = log.filter((l) => l.kind === 'error').length
  const tabs = [
    ...results.map((r, i) => ({ id: r.id, label: results.length > 1 ? `Resultado ${i + 1}` : 'Resultado', icon: <Rows3 className="size-3.5" /> })),
    {
      id: 'log',
      label: 'Mensagens',
      icon: errors ? <XCircle className="size-3.5 text-err" /> : <TerminalSquare className="size-3.5" />
    }
  ]

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => onActive(t.id)}
              className={cn(
                'relative flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors',
                active === t.id ? 'text-fg' : 'text-muted hover:text-fg'
              )}
            >
              {active === t.id && (
                <motion.span
                  layoutId="result-tab"
                  className="absolute inset-0 rounded-md bg-elev-2"
                  transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                />
              )}
              <span className="relative flex items-center gap-1.5">
                {t.icon}
                {t.label}
              </span>
            </button>
          ))}
        </div>
        {running ? (
          <div className="flex items-center gap-2 pr-1 text-[12px] text-accent">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-accent" />
            </span>
            Executando · {formatDuration(elapsed)}
          </div>
        ) : (
          current && (
            <div className="flex items-center gap-3 pr-1 text-[12px] text-muted">
              {current.result.truncated && (
                <span className="flex items-center gap-1 text-warn" title={`Limite de ${maxRows} linhas por consulta`}>
                  <AlertTriangle className="size-3.5" /> limitado a {formatCount(maxRows)}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Rows3 className="size-3.5" />
                {describeResult(current.result)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="size-3.5" />
                {formatDuration(current.result.durationMs)}
              </span>
              {current.result.fields.length > 0 && <ExportButton result={projectResult(current.result, visibleCols)} name="resultado" />}
            </div>
          )
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {active === 'log' || !current ? (
          <MessageLog log={log} />
        ) : current.result.fields.length ? (
          <FkGrid
            key={current.id}
            connId={current.connId}
            database={current.database}
            fields={current.result.fields}
            rows={current.result.rows}
            onVisibleColumnsChange={setVisibleCols}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
            <CheckCircle2 className="size-8 text-ok" strokeWidth={1.5} />
            <div className="text-[13px] text-fg">{describeResult(current.result)}</div>
            <div className="text-[12px]">{formatDuration(current.result.durationMs)}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function MessageLog({ log }: { log: LogEntry[] }) {
  if (!log.length) {
    return (
      <div className="flex h-full items-center justify-center text-[12.5px] text-faint">
        Execute uma consulta para ver os resultados aqui
      </div>
    )
  }
  return (
    <div className="h-full overflow-auto p-2 select-text">
      {log.map((l) => (
        <div key={l.id} className="group flex gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.02]">
          <div className="pt-0.5">
            {l.kind === 'ok' && <CheckCircle2 className="size-4 text-ok" />}
            {l.kind === 'error' && <XCircle className="size-4 text-err" />}
            {l.kind === 'notice' && <Info className="size-4 text-cyan" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className={cn('text-[12.5px]', l.kind === 'error' ? 'text-err' : 'text-fg')}>{l.text}</div>
            {l.error?.detail && <div className="mt-0.5 text-[12px] text-muted">Detalhe: {l.error.detail}</div>}
            {l.error?.hint && <div className="mt-0.5 text-[12px] text-muted">Dica: {l.error.hint}</div>}
            <div className="mt-1 truncate font-mono text-[11.5px] text-faint">{l.sql.replace(/\s+/g, ' ')}</div>
          </div>
          <div className="shrink-0 text-right text-[11px] text-faint tabular-nums">
            <div>{new Date(l.at).toLocaleTimeString('pt-BR')}</div>
            {l.durationMs !== undefined && <div>{formatDuration(l.durationMs)}</div>}
            {l.error?.code && <div className="font-mono">{l.error.code}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}
