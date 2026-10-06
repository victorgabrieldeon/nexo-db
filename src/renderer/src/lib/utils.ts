import type { QueryError } from '@shared/types'

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function uid(): string {
  return crypto.randomUUID()
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

export function formatDuration(ms: number): string {
  if (ms < 1) return '<1 ms'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

export function formatCount(n: number): string {
  return n.toLocaleString('pt-BR')
}

export function errorInfo(e: unknown): QueryError {
  const info = (e as { info?: QueryError })?.info
  if (info) return info
  return { message: e instanceof Error ? e.message : String(e) }
}

export function errorMessage(e: unknown): string {
  return errorInfo(e).message
}

export function quoteIdent(name: string): string {
  return /^[a-z_][a-z0-9_$]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`
}

export function qualifiedName(schema: string, name: string): string {
  return schema === 'public' ? quoteIdent(name) : `${quoteIdent(schema)}.${quoteIdent(name)}`
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'agora'
  if (s < 3600) return `${Math.floor(s / 60)} min`
  if (s < 86400) return `${Math.floor(s / 3600)} h`
  return new Date(ts).toLocaleDateString('pt-BR')
}

export const isMac = window.api.platform === 'darwin'
export const modKey = isMac ? '⌘' : 'Ctrl'
