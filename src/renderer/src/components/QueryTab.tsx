import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { Database, ListTree, Play, PlayCircle, RefreshCw, Square } from 'lucide-react'
import { toast } from 'sonner'
import type { QueryError } from '@shared/types'
import { useTabs, type QueryTab as QueryTabModel } from '@/stores/tabs'
import { completionKey, useConnections } from '@/stores/connections'
import { useUi } from '@/stores/ui'
import { splitStatements, stripTrailingSemicolon } from '@/lib/sqlSplit'
import { cn, errorInfo, modKey, uid } from '@/lib/utils'
import { SqlEditor, type SqlEditorHandle } from './SqlEditor'
import { ResultsPanel, describeResult, type LogEntry, type ResultEntry } from './ResultsPanel'
import { Dropdown } from './Dropdown'
import { Button, IconButton, Kbd } from './ui'

export function QueryTab({ tab, active }: { tab: QueryTabModel; active: boolean }) {
  const editor = useRef<SqlEditorHandle>(null)
  const update = useTabs((s) => s.update)
  const list = useConnections((s) => s.list)
  const status = useConnections((s) => (tab.connId ? s.status[tab.connId] : undefined))
  const server = useConnections((s) => (tab.connId ? s.server[tab.connId] : undefined))
  const ensureConnected = useConnections((s) => s.ensureConnected)
  const loadCompletion = useConnections((s) => s.loadCompletion)
  const database = tab.database ?? server?.database ?? null
  const completion = useConnections((s) => (tab.connId && database ? s.completion[completionKey(tab.connId, database)] : null))
  const maxRows = useUi((s) => s.maxRows)

  const [results, setResults] = useState<ResultEntry[]>([])
  const [log, setLog] = useState<LogEntry[]>([])
  const [activeResult, setActiveResult] = useState('log')
  const [running, setRunning] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [inTx, setInTx] = useState(false)
  const [databases, setDatabases] = useState<string[]>([])
  const [loadingDbs, setLoadingDbs] = useState(false)

  const conn = list.find((c) => c.id === tab.connId)

  useEffect(() => {
    if (tab.connId && database && status === 'connected') loadCompletion(tab.connId, database)
  }, [tab.connId, database, status, loadCompletion])

  useEffect(() => {
    if (active) requestAnimationFrame(() => editor.current?.focus())
  }, [active])

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setElapsed(performance.now() - startedAt), 100)
    return () => clearInterval(t)
  }, [running, startedAt])

  // salva o SQL com debounce para não regravar o localStorage a cada tecla
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const onChange = useCallback(
    (sql: string) => {
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => update(tab.id, { sql }), 300)
    },
    [tab.id, update]
  )

  const prepare = async (): Promise<{ connId: string; database: string } | null> => {
    if (!tab.connId) {
      toast.message('Selecione uma conexão para executar', { description: 'Use o seletor no topo do editor.' })
      return null
    }
    if (!(await ensureConnected(tab.connId))) return null
    const db = tab.database ?? useConnections.getState().server[tab.connId]?.database
    if (!db) return null
    return { connId: tab.connId, database: db }
  }

  const pushLog = (e: Omit<LogEntry, 'id' | 'at'>): void => {
    setLog((l) => [{ ...e, id: uid(), at: Date.now() }, ...l].slice(0, 200))
  }

  const showError = (err: QueryError, sql: string, offset: number): void => {
    pushLog({ kind: 'error', sql, text: err.message, error: err })
    setActiveResult('log')
    if (err.position) {
      const pos = offset + err.position - 1
      const rest = sql.slice(err.position - 1)
      const len = Math.max(1, /^[\w"$.]+/.exec(rest)?.[0].length ?? 1)
      editor.current?.markError(pos, pos + len)
    }
  }

  /** `shift` corrige a posição do erro quando o texto enviado tem um prefixo (ex.: EXPLAIN). */
  const runStatements = async (stmts: { text: string; from: number; to: number; shift?: number }[]): Promise<void> => {
    const target = await prepare()
    if (!target || !stmts.length) return
    setRunning(true)
    const t0 = performance.now()
    setStartedAt(t0)
    setElapsed(0)
    const newResults: ResultEntry[] = []
    try {
      for (const stmt of stmts) {
        editor.current?.flash(stmt.from, stmt.to)
        const sql = stripTrailingSemicolon(stmt.text)
        const res = await window.api.query.execute(tab.id, target.connId, target.database, sql, maxRows)
        setInTx(res.inTransaction)
        if (!res.ok) {
          showError(res.error, sql, stmt.from + (stmt.shift ?? 0))
          break
        }
        const r = res.result
        for (const n of r.notices) pushLog({ kind: 'notice', sql, text: n })
        pushLog({ kind: 'ok', sql, text: describeResult(r), durationMs: r.durationMs })
        if (r.fields.length || stmts.length === 1) newResults.push({ id: uid(), sql, result: r, connId: target.connId, database: target.database })
      }
    } catch (e) {
      showError(errorInfo(e), stmts[0].text, stmts[0].from)
    } finally {
      setRunning(false)
      if (newResults.length) {
        setResults(newResults.slice(-20))
        setActiveResult(newResults[0].id)
      }
    }
  }

  const run = (): void => {
    if (running) return
    const target = editor.current?.getRunTarget()
    if (!target) return
    if (target.isSelection) {
      const stmts = splitStatements(target.text).map((s) => ({ ...s, from: s.from + target.from, to: s.to + target.from }))
      void runStatements(stmts.length > 1 ? stmts : [target])
    } else void runStatements([target])
  }

  const runScript = (): void => {
    if (running) return
    const target = editor.current?.getRunTarget()
    const base = target?.isSelection ? target : { text: editor.current?.getValue() ?? '', from: 0 }
    const stmts = splitStatements(base.text).map((s) => ({ ...s, from: s.from + base.from, to: s.to + base.from }))
    void runStatements(stmts)
  }

  const explain = (): void => {
    if (running) return
    const target = editor.current?.getRunTarget()
    if (!target) return
    void runStatements([{ ...target, text: `EXPLAIN ${stripTrailingSemicolon(target.text)}`, shift: -8 }])
  }

  const cancel = async (): Promise<void> => {
    const ok = await window.api.query.cancel(tab.id).catch(() => false)
    if (!ok) toast.message('Nada para cancelar')
  }

  const txCommand = (cmd: 'COMMIT' | 'ROLLBACK'): void => {
    void runStatements([{ text: cmd, from: 0, to: 0 }])
  }

  const loadDatabases = async (): Promise<void> => {
    if (!tab.connId) return
    setLoadingDbs(true)
    try {
      if (await ensureConnected(tab.connId)) setDatabases(await window.api.meta.databases(tab.connId))
    } finally {
      setLoadingDbs(false)
    }
  }

  const connOptions = useMemo(
    () =>
      list.map((c) => ({
        value: c.id,
        label: c.name,
        hint: c.host,
        icon: <span className="size-2 rounded-full" style={{ background: c.color }} />
      })),
    [list]
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
        <Button variant="primary" size="sm" onClick={run} disabled={running} title={`Executar comando (${modKey}+Enter)`}>
          <Play className="size-3.5 fill-current" /> Executar
        </Button>
        <IconButton onClick={runScript} disabled={running} title={`Executar script (${modKey}+Shift+Enter)`}>
          <PlayCircle className="size-4" />
        </IconButton>
        <IconButton onClick={explain} disabled={running} title={`Explain (${modKey}+Shift+E)`}>
          <ListTree className="size-4" />
        </IconButton>
        {running && (
          <Button variant="danger" size="sm" onClick={cancel}>
            <Square className="size-3 fill-current" /> Cancelar
          </Button>
        )}

        <div className="mx-1.5 h-4 w-px bg-line-strong" />

        <Dropdown
          value={tab.connId}
          options={connOptions}
          placeholder="Escolher conexão"
          icon={<Database className="size-3.5" />}
          onChange={(connId) => {
            update(tab.id, { connId, database: null })
            setDatabases([])
            void ensureConnected(connId)
          }}
          searchable={connOptions.length > 6}
        />
        {tab.connId && (
          <>
            <span className="text-faint">/</span>
            <Dropdown
              value={database}
              options={(databases.length ? databases : database ? [database] : []).map((d) => ({
                value: d,
                label: d,
                icon: <Database className="size-3.5 text-muted" />
              }))}
              placeholder="banco"
              onOpen={loadDatabases}
              loading={loadingDbs}
              onChange={(db) => update(tab.id, { database: db })}
              searchable
            />
          </>
        )}
        {tab.connId && database && status === 'connected' && (
          <IconButton
            size="sm"
            title="Recarregar metadados do autocomplete"
            onClick={async () => {
              await loadCompletion(tab.connId!, database, true)
              toast.success('Autocomplete atualizado')
            }}
          >
            <RefreshCw className="size-3" />
          </IconButton>
        )}

        <div className="flex-1" />

        {inTx && (
          <div className="flex items-center gap-1 rounded-lg bg-warn/10 py-0.5 pr-0.5 pl-2.5 text-[12px] text-warn ring-1 ring-warn/25">
            <span className="mr-1">Transação aberta</span>
            <Button size="sm" variant="ghost" className="h-6 text-ok hover:text-ok" onClick={() => txCommand('COMMIT')}>
              Commit
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-err hover:text-err" onClick={() => txCommand('ROLLBACK')}>
              Rollback
            </Button>
          </div>
        )}
        {conn && (
          <div className="flex items-center gap-1.5 pr-1 text-[11.5px] text-faint">
            <span
              className={cn(
                'size-1.5 rounded-full',
                status === 'connected' ? 'bg-ok' : status === 'connecting' ? 'animate-pulse bg-warn' : 'bg-faint'
              )}
            />
            {status === 'connected' ? 'conectado' : status === 'connecting' ? 'conectando…' : 'desconectado'}
          </div>
        )}
      </div>

      <Group orientation="vertical" className="min-h-0 flex-1">
        <Panel defaultSize="55%" minSize="15%">
          <div className="relative h-full bg-bg">
            <SqlEditor
              ref={editor}
              value={tab.sql}
              onChange={onChange}
              completion={completion}
              onRun={run}
              onRunScript={runScript}
              onExplain={explain}
              placeholder="-- Escreva sua consulta. Ctrl+Espaço para sugestões"
            />
            {!tab.sql && (
              <div className="pointer-events-none absolute right-5 bottom-4 flex flex-col items-end gap-1.5 text-[11.5px] text-faint">
                <span className="flex items-center gap-1.5">
                  Executar comando <Kbd>{modKey}</Kbd>
                  <Kbd>Enter</Kbd>
                </span>
                <span className="flex items-center gap-1.5">
                  Executar script <Kbd>{modKey}</Kbd>
                  <Kbd>⇧</Kbd>
                  <Kbd>Enter</Kbd>
                </span>
                <span className="flex items-center gap-1.5">
                  Autocomplete <Kbd>{modKey}</Kbd>
                  <Kbd>Espaço</Kbd>
                </span>
              </div>
            )}
          </div>
        </Panel>
        <Separator />
        <Panel minSize="12%">
          <ResultsPanel
            results={results}
            log={log}
            active={results.some((r) => r.id === activeResult) ? activeResult : 'log'}
            onActive={setActiveResult}
            running={running}
            elapsed={elapsed}
            maxRows={maxRows}
          />
        </Panel>
      </Group>
    </div>
  )
}
