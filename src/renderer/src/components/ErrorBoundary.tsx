import { Component, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from './ui'

/** Isola falhas de renderização: um erro numa aba não derruba o app inteiro. */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error('[nexo] erro de renderização', error)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-[520px] rounded-2xl border border-err/30 bg-err/[0.06] p-5">
          <div className="flex items-center gap-2 text-[13.5px] font-semibold text-err">
            <AlertTriangle className="size-4" /> Algo deu errado {this.props.label ? `em ${this.props.label}` : ''}
          </div>
          <pre className="mt-2 max-h-40 overflow-auto font-mono text-[12px] whitespace-pre-wrap text-muted select-text">{error.message}</pre>
          <Button className="mt-4" size="sm" onClick={() => this.setState({ error: null })}>
            <RotateCcw className="size-3.5" /> Tentar novamente
          </Button>
        </div>
      </div>
    )
  }
}
