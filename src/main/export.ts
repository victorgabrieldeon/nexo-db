import { dialog, BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import type { ExportRequest } from '../shared/types'
import { quoteIdent } from './db'

function csvCell(v: string | null): string {
  if (v === null) return ''
  return /[",\n\r;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function sqlLiteral(v: string | null): string {
  return v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`
}

export function serialize(req: ExportRequest): string {
  if (req.format === 'csv') {
    return [req.fields.map(csvCell).join(','), ...req.rows.map((r) => r.map(csvCell).join(','))].join('\n')
  }
  if (req.format === 'json') {
    const objects = req.rows.map((r) => Object.fromEntries(req.fields.map((f, i) => [f, r[i]])))
    return JSON.stringify(objects, null, 2)
  }
  const table = req.tableName ?? 'tabela'
  const cols = req.fields.map(quoteIdent).join(', ')
  return req.rows.map((r) => `INSERT INTO ${table} (${cols}) VALUES (${r.map(sqlLiteral).join(', ')});`).join('\n')
}

export async function exportResult(win: BrowserWindow, req: ExportRequest): Promise<string | null> {
  const ext = req.format
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: `${req.suggestedName}.${ext}`,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
  })
  if (canceled || !filePath) return null
  await writeFile(filePath, serialize(req), 'utf8')
  return filePath
}
