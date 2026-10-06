import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CheckCircle2, Database, KeyRound, PlugZap, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { ConnectionConfig, SslMode } from '@shared/types'
import { useConnections } from '@/stores/connections'
import { cn, errorMessage } from '@/lib/utils'
import { Button, Modal, Segmented } from './ui'

const COLORS = ['#6d8cff', '#a78bfa', '#3ddc97', '#5ccfe6', '#f5b84a', '#ff9e64', '#ff6b81', '#e4e7ee']

const blank = (): ConnectionConfig => ({
  id: '',
  name: '',
  host: 'localhost',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: '',
  savePassword: true,
  ssl: 'disable',
  color: COLORS[Math.floor(Math.random() * 6)]
})

/** postgres://user:pass@host:port/db?sslmode=require */
function parseUrl(url: string): Partial<ConnectionConfig> | null {
  try {
    const u = new URL(url.trim())
    if (!/^postgres(ql)?:$/.test(u.protocol)) return null
    const sslmode = u.searchParams.get('sslmode')
    return {
      host: u.hostname || 'localhost',
      port: u.port ? Number(u.port) : 5432,
      user: decodeURIComponent(u.username || 'postgres'),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres',
      ssl: sslmode === 'require' || sslmode === 'verify-full' ? 'require' : sslmode === 'prefer' || sslmode === 'no-verify' ? 'no-verify' : 'disable',
      name: u.hostname
    }
  } catch {
    return null
  }
}

export function ConnectionDialog() {
  const dialog = useConnections((s) => s.dialog)
  const close = useConnections((s) => s.closeDialog)
  const save = useConnections((s) => s.save)
  const connect = useConnections((s) => s.connect)
  const [form, setForm] = useState<ConnectionConfig>(blank)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (dialog) {
      setForm(dialog.editing ? { ...blank(), ...dialog.editing, password: dialog.editing.password ?? '' } : blank())
      setTest(null)
    }
  }, [dialog])

  const set = <K extends keyof ConnectionConfig>(k: K, v: ConnectionConfig[K]): void => {
    setForm((f) => ({ ...f, [k]: v }))
    setTest(null)
  }

  const onPaste = (e: React.ClipboardEvent): void => {
    const text = e.clipboardData.getData('text')
    const parsed = parseUrl(text)
    if (parsed) {
      e.preventDefault()
      setForm((f) => ({ ...f, ...parsed, name: f.name || parsed.name || '' }))
      toast.success('URL de conexão reconhecida')
    }
  }

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTest(null)
    try {
      const info = await window.api.connections.test(form)
      setTest({ ok: true, text: info.version.split(',')[0] })
    } catch (e) {
      setTest({ ok: false, text: errorMessage(e) })
    } finally {
      setTesting(false)
    }
  }

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setSaving(true)
    try {
      const id = await save({ ...form, name: form.name.trim() || `${form.host}/${form.database}` })
      close()
      if (!dialog?.editing?.id) void connect(id)
    } catch (err) {
      toast.error('Falha ao salvar', { description: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  const editing = !!dialog?.editing?.id

  return (
    <Modal
      open={!!dialog}
      onClose={close}
      title={editing ? 'Editar conexão' : 'Nova conexão PostgreSQL'}
      description="Dica: cole uma URL postgres:// em qualquer campo para preencher tudo de uma vez."
      icon={<Database className="size-4.5" />}
      width={560}
    >
      <form onSubmit={submit} onPaste={onPaste} className="space-y-4 px-5 pb-5">
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label="Nome">
            <input className="field" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Produção, Local…" autoFocus />
          </Field>
          <div className="flex h-8 items-center gap-1.5 pb-px">
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => set('color', c)}
                className={cn(
                  'size-4 rounded-full transition-transform duration-150 hover:scale-110',
                  form.color === c && 'ring-2 ring-white/70 ring-offset-2 ring-offset-panel'
                )}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-[1fr_96px] gap-3">
          <Field label="Host">
            <input className="field font-mono" value={form.host} onChange={(e) => set('host', e.target.value)} required spellCheck={false} />
          </Field>
          <Field label="Porta">
            <input className="field font-mono" type="number" value={form.port} onChange={(e) => set('port', Number(e.target.value))} required />
          </Field>
        </div>

        <Field label="Banco de dados">
          <input className="field font-mono" value={form.database} onChange={(e) => set('database', e.target.value)} required spellCheck={false} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Usuário">
            <input className="field font-mono" value={form.user} onChange={(e) => set('user', e.target.value)} required spellCheck={false} />
          </Field>
          <Field label="Senha">
            <input
              className="field font-mono"
              type="password"
              value={form.password ?? ''}
              onChange={(e) => set('password', e.target.value)}
              placeholder={form.savePassword ? '' : 'perguntar ao conectar'}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 items-end gap-3">
          <div>
            <span className="mb-1.5 block text-[11.5px] font-medium text-muted">SSL</span>
            <Segmented<SslMode>
              layoutId="ssl-mode"
              value={form.ssl}
              onChange={(v) => set('ssl', v)}
              options={[
                { value: 'disable', label: 'Desativado' },
                { value: 'require', label: 'Exigir' },
                { value: 'no-verify', label: 'Sem verificar' }
              ]}
            />
          </div>
          <label className="flex h-8 cursor-default items-center gap-2 text-[12.5px] text-muted" title="A senha é cifrada com o chaveiro do sistema operacional">
            <Toggle checked={form.savePassword} onChange={(v) => set('savePassword', v)} />
            <KeyRound className="size-3.5" /> Salvar senha
          </label>
        </div>

        <AnimatePresence>
          {test && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div
                className={cn(
                  'flex items-start gap-2 rounded-xl px-3 py-2.5 text-[12.5px]',
                  test.ok ? 'bg-ok/10 text-ok ring-1 ring-ok/25' : 'bg-err/10 text-err ring-1 ring-err/25'
                )}
              >
                {test.ok ? <CheckCircle2 className="mt-px size-4 shrink-0" /> : <XCircle className="mt-px size-4 shrink-0" />}
                <span className="select-text">{test.ok ? `Conectado — ${test.text}` : test.text}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center justify-between pt-1">
          <Button type="button" variant="ghost" onClick={runTest} loading={testing}>
            {!testing && <PlugZap className="size-3.5" />} Testar conexão
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              {editing ? 'Salvar' : 'Salvar e conectar'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-medium text-muted">{label}</span>
      {children}
    </label>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn('relative h-[18px] w-8 rounded-full transition-colors duration-200', checked ? 'bg-accent' : 'bg-line-strong')}
    >
      <motion.span
        className="absolute top-[2px] left-[2px] size-[14px] rounded-full bg-white shadow"
        animate={{ x: checked ? 14 : 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 35 }}
      />
    </button>
  )
}

export function PasswordPrompt() {
  const prompt = useConnections((s) => s.passwordPrompt)
  const [value, setValue] = useState('')

  useEffect(() => setValue(''), [prompt])

  return (
    <Modal
      open={!!prompt}
      onClose={() => prompt?.resolve(null)}
      title={`Senha para ${prompt?.connection.name ?? ''}`}
      description={prompt ? `${prompt.connection.user}@${prompt.connection.host}` : undefined}
      icon={<KeyRound className="size-4.5" />}
      width={400}
    >
      <form
        className="space-y-4 px-5 pb-5"
        onSubmit={(e) => {
          e.preventDefault()
          prompt?.resolve(value)
        }}
      >
        <input className="field font-mono" type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => prompt?.resolve(null)}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary">
            Conectar
          </Button>
        </div>
      </form>
    </Modal>
  )
}
