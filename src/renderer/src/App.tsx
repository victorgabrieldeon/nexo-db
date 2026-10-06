import { useEffect } from 'react'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { Toaster } from 'sonner'
import { PanelLeft, Search } from 'lucide-react'
import { defaultConnId, useConnections } from '@/stores/connections'
import { useTabs } from '@/stores/tabs'
import { useUi } from '@/stores/ui'
import { cn, isMac, modKey } from '@/lib/utils'
import { Sidebar } from './components/Sidebar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Workspace, Logo } from './components/Workspace'
import { ConnectionDialog, PasswordPrompt } from './components/ConnectionDialog'
import { CommandPalette } from './components/CommandPalette'
import { ContextMenuHost, IconButton, Kbd } from './components/ui'

export function App() {
  const load = useConnections((s) => s.load)
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const sidebar = usePanelRef()

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const p = sidebar.current
    if (!p) return
    if (sidebarOpen && p.isCollapsed()) p.expand()
    if (!sidebarOpen && !p.isCollapsed()) p.collapse()
  }, [sidebarOpen, sidebar])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const tabs = useTabs.getState()
      const key = e.key.toLowerCase()
      if (key === 'k' || (key === 'p' && !e.shiftKey)) {
        e.preventDefault()
        useUi.getState().setPaletteOpen(!useUi.getState().paletteOpen)
      } else if (key === 't') {
        e.preventDefault()
        const active = tabs.tabs.find((t) => t.id === tabs.activeId)
        tabs.newQuery({ connId: defaultConnId(active?.connId), database: active?.database ?? null })
      } else if (key === 'w') {
        e.preventDefault()
        if (tabs.activeId) tabs.close(tabs.activeId)
      } else if (key === 'b') {
        e.preventDefault()
        useUi.getState().toggleSidebar()
      } else if (e.key === 'Tab') {
        e.preventDefault()
        tabs.cycle(e.shiftKey ? -1 : 1)
      } else if (e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault()
        tabs.cycle(e.key === 'PageDown' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel
          panelRef={sidebar}
          defaultSize={280}
          minSize={200}
          maxSize="45%"
          collapsible
          collapsedSize={0}
          onResize={(size) => {
            const open = size.inPixels > 0
            if (open !== useUi.getState().sidebarOpen) useUi.setState({ sidebarOpen: open })
          }}
        >
          <ErrorBoundary label="barra lateral">
            <Sidebar />
          </ErrorBoundary>
        </Panel>
        <Separator />
        <Panel minSize="30%">
          <Workspace />
        </Panel>
      </Group>

      <ConnectionDialog />
      <PasswordPrompt />
      <CommandPalette />
      <ContextMenuHost />
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#151922f2',
            border: '1px solid #2a303c',
            color: '#e4e7ee',
            backdropFilter: 'blur(12px)',
            fontFamily: 'var(--font-sans)',
            fontSize: '12.5px'
          }
        }}
      />
    </div>
  )
}

function TitleBar() {
  const toggleSidebar = useUi((s) => s.toggleSidebar)
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)

  return (
    <div className={cn('drag titlebar-safe relative flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel', isMac ? 'pl-[78px]' : 'pl-3')}>
      <div className="flex items-center gap-2">
        <Logo size={18} />
        <span className="text-[12.5px] font-semibold tracking-tight">Nexo DB</span>
      </div>
      <IconButton className="no-drag ml-1" active={sidebarOpen} onClick={toggleSidebar} title={`Barra lateral (${modKey}+B)`}>
        <PanelLeft className="size-4" />
      </IconButton>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <button
          onClick={() => setPaletteOpen(true)}
          className="no-drag pointer-events-auto flex h-7 w-[min(420px,40vw)] items-center gap-2 rounded-lg bg-bg/70 px-2.5 text-[12.5px] text-faint ring-1 ring-line-strong transition-all hover:text-muted hover:ring-accent/50"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Buscar tabelas, conexões, comandos…</span>
          <Kbd>{modKey}</Kbd>
          <Kbd>K</Kbd>
        </button>
      </div>
    </div>
  )
}
