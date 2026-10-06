import { useMemo } from 'react'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Modal } from './ui'
import { isJsonType } from '@/lib/pgTypes'

export function ValueViewer({
  open,
  title,
  type,
  value,
  onClose
}: {
  open: boolean
  title: string
  type: string
  value: string | null
  onClose: () => void
}) {
  const pretty = useMemo(() => {
    if (value === null) return null
    if (isJsonType(type) || /^\s*[[{]/.test(value)) {
      try {
        return JSON.stringify(JSON.parse(value), null, 2)
      } catch {
        /* não é JSON válido */
      }
    }
    return value
  }, [value, type])

  return (
    <Modal open={open} onClose={onClose} title={title} description={type} width={720}>
      <div className="px-5 pb-5">
        <pre className="max-h-[60vh] overflow-auto rounded-xl border border-line bg-bg p-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-all text-fg select-text">
          {pretty === null ? <span className="text-faint italic">NULL</span> : pretty}
        </pre>
        <div className="mt-3 flex justify-between text-[11.5px] text-faint">
          <span>{value === null ? '' : `${value.length.toLocaleString('pt-BR')} caracteres`}</span>
          <Button
            size="sm"
            onClick={() => {
              window.api.copy(pretty ?? '')
              toast.success('Valor copiado')
            }}
          >
            <Copy className="size-3.5" /> Copiar
          </Button>
        </div>
      </div>
    </Modal>
  )
}
