export interface Statement {
  from: number
  to: number
  text: string
}

/**
 * Divide SQL em comandos respeitando strings, identificadores entre aspas,
 * comentários (inclusive aninhados) e corpos $tag$...$tag$.
 * Com `blankLineSplits`, uma linha em branco fora de literais também separa comandos.
 */
export function splitStatements(sql: string, blankLineSplits = false): Statement[] {
  const out: Statement[] = []
  let start = 0
  let i = 0
  const n = sql.length

  const push = (end: number): void => {
    const raw = sql.slice(start, end)
    const lead = raw.length - raw.trimStart().length
    const text = raw.trim()
    if (text && !isOnlyComments(text)) out.push({ from: start + lead, to: start + lead + text.length, text })
  }

  while (i < n) {
    const c = sql[i]
    const next = sql[i + 1]
    if (c === "'" || c === '"') {
      i++
      while (i < n) {
        if (sql[i] === c) {
          if (sql[i + 1] === c) i += 2
          else break
        } else i++
      }
      i++
    } else if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++
    } else if (c === '/' && next === '*') {
      let depth = 1
      i += 2
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++
          i += 2
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--
          i += 2
        } else i++
      }
    } else if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64))
      if (m && !/[A-Za-z0-9_]/.test(sql[i - 1] ?? '')) {
        const tag = m[0]
        const close = sql.indexOf(tag, i + tag.length)
        i = close === -1 ? n : close + tag.length
      } else i++
    } else if (c === ';') {
      push(i + 1)
      i++
      start = i
    } else if (blankLineSplits && c === '\n' && /^\n[ \t]*\n/.test(sql.slice(i, i + 200))) {
      push(i)
      start = i + 1
      i++
    } else i++
  }
  push(n)
  return out
}

function isOnlyComments(text: string): boolean {
  return text.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/;/g, '').trim() === ''
}

/** Comando sob o cursor (separado por `;` ou linha em branco). */
export function statementAt(sql: string, pos: number): Statement | null {
  const stmts = splitStatements(sql, true)
  if (!stmts.length) return null
  for (const s of stmts) if (pos >= s.from && pos <= s.to) return s
  // cursor entre comandos: usa o anterior mais próximo na mesma região, senão o próximo
  let before: Statement | null = null
  for (const s of stmts) if (s.to <= pos) before = s
  if (before && !/\n[ \t]*\n/.test(sql.slice(before.to, pos))) return before
  return stmts.find((s) => s.from >= pos) ?? before
}

/** Remove o `;` final, que o protocolo estendido não precisa. */
export function stripTrailingSemicolon(text: string): string {
  return text.replace(/;\s*$/, '')
}
