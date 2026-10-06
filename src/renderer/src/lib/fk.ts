import { useEffect, useMemo, useState } from 'react'
import type { FieldInfo, ForeignKey } from '@shared/types'

/**
 * FK ligada às colunas de um resultado.
 * 'out': a coluna é a FK (aponta para outra tabela). 'in': a coluna é referenciada por FK de outra tabela.
 * `positions[i]` é o índice do campo correspondente à i-ésima coluna da constraint (do lado presente no resultado).
 */
export interface FkRef {
  fk: ForeignKey
  dir: 'out' | 'in'
  positions: number[]
}

/** Alvo de uma navegação: tabela + WHERE para chegar nas linhas relacionadas. */
export interface FkTarget {
  schema: string
  table: string
  where: string
  label: string
  /** colunas usadas na ligação, do lado da tabela alvo (ex.: "cliente_id") */
  via: string
}

const cache = new Map<string, Promise<ForeignKey[]>>()

function fetchFks(connId: string, database: string, oid: number, dir: 'out' | 'in'): Promise<ForeignKey[]> {
  const key = `${connId}|${database}|${oid}|${dir}`
  let p = cache.get(key)
  if (!p) {
    p = window.api.meta.foreignKeys(connId, database, [oid], dir).catch(() => {
      cache.delete(key)
      return []
    })
    cache.set(key, p)
  }
  return p
}

export interface FkMaps {
  /** coluna → FK que ela declara */
  out: Map<number, FkRef>
  /** coluna → FKs de outras tabelas que apontam para ela */
  in: Map<number, FkRef[]>
}

/** Descobre FKs nas duas direções a partir da tabela/coluna de origem de cada campo. */
export function useForeignKeys(connId: string | null, database: string | null, fields: FieldInfo[]): FkMaps {
  const [fks, setFks] = useState<{ out: ForeignKey[]; in: ForeignKey[] }>({ out: [], in: [] })
  const oidsKey = [...new Set(fields.map((f) => f.tableId).filter(Boolean))].sort().join(',')

  useEffect(() => {
    if (!connId || !database || !oidsKey) {
      setFks({ out: [], in: [] })
      return
    }
    let cancelled = false
    const oids = oidsKey.split(',').map(Number)
    Promise.all([
      Promise.all(oids.map((oid) => fetchFks(connId, database, oid, 'out'))),
      Promise.all(oids.map((oid) => fetchFks(connId, database, oid, 'in')))
    ]).then(([out, inc]) => {
      if (!cancelled) setFks({ out: out.flat(), in: inc.flat() })
    })
    return () => {
      cancelled = true
    }
  }, [connId, database, oidsKey])

  return useMemo(() => {
    const find = (tableOid: number, attnums: number[]): number[] =>
      attnums.map((attnum) => fields.findIndex((f) => f.tableId === tableOid && f.columnId === attnum))

    const out = new Map<number, FkRef>()
    for (const fk of fks.out) {
      const positions = find(fk.tableOid, fk.attnums)
      // só dá para navegar se todas as colunas da FK estiverem no resultado
      if (positions.some((p) => p < 0)) continue
      for (const p of positions) if (!out.has(p)) out.set(p, { fk, dir: 'out', positions })
    }

    const inc = new Map<number, FkRef[]>()
    for (const fk of fks.in) {
      const positions = find(fk.refTableOid, fk.refAttnums)
      if (positions.some((p) => p < 0)) continue
      // a seta fica na primeira coluna referenciada (em geral o id)
      const list = inc.get(positions[0]) ?? []
      list.push({ fk, dir: 'in', positions })
      inc.set(positions[0], list)
    }
    return { out, in: inc }
  }, [fks, fields])
}

function literal(v: string): string {
  return `'${v.replace(/'/g, "''")}'`
}

function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** Para onde a navegação leva; null se alguma coluna envolvida for NULL. */
export function fkTarget(ref: FkRef, row: (string | null)[]): FkTarget | null {
  const values = ref.positions.map((p) => row[p])
  if (values.some((v) => v === null)) return null
  const shown = values.join(', ')
  if (ref.dir === 'out') {
    return {
      schema: ref.fk.refSchema,
      table: ref.fk.refTable,
      where: ref.fk.refColumns.map((c, i) => `${ident(c)} = ${literal(values[i]!)}`).join(' and '),
      label: `${ref.fk.refTable} · ${ref.fk.refColumns.join(', ')} = ${shown}`,
      via: ref.fk.refColumns.join(', ')
    }
  }
  return {
    schema: ref.fk.schema,
    table: ref.fk.table,
    where: ref.fk.columns.map((c, i) => `${ident(c)} = ${literal(values[i]!)}`).join(' and '),
    label: `${ref.fk.table} · ${ref.fk.columns.join(', ')} = ${shown}`,
    via: ref.fk.columns.join(', ')
  }
}

/** Descrição curta: destino (out) ou origem (in) da FK. */
export function fkLabel(ref: FkRef): string {
  if (ref.dir === 'out') {
    return `${ref.fk.refSchema === 'public' ? '' : `${ref.fk.refSchema}.`}${ref.fk.refTable}(${ref.fk.refColumns.join(', ')})`
  }
  return `${ref.fk.schema === 'public' ? '' : `${ref.fk.schema}.`}${ref.fk.table}(${ref.fk.columns.join(', ')})`
}
