const NUMERIC = new Set(['int2', 'int4', 'int8', 'float4', 'float8', 'numeric', 'oid', 'money', 'xid'])

export function isNumericType(typeName: string): boolean {
  return NUMERIC.has(typeName)
}

export function isBoolType(typeName: string): boolean {
  return typeName === 'bool'
}

export function isJsonType(typeName: string): boolean {
  return typeName === 'json' || typeName === 'jsonb'
}
