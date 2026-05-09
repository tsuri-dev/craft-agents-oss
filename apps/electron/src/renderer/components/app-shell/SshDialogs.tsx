import * as React from 'react'
import { Copy, KeyRound, Server, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { SshConnectionProfile, SshPrivateKeyRecord } from '../../../shared/types'

interface SshKeyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string | null
  keys: SshPrivateKeyRecord[]
  onChanged: () => Promise<void> | void
}

interface SshProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string | null
  keys: SshPrivateKeyRecord[]
  profile?: SshConnectionProfile | null
  onChanged: () => Promise<void> | void
}

export function SshKeyDialog({ open, onOpenChange, workspaceId, keys, onChanged }: SshKeyDialogProps) {
  const [name, setName] = React.useState('')
  const [privateKeyPath, setPrivateKeyPath] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setName('')
    setPrivateKeyPath('')
  }, [open])

  const submit = async () => {
    if (!workspaceId) return
    setSaving(true)
    try {
      await window.electronAPI.createSshKey(workspaceId, { name, privateKeyPath })
      toast.success('SSH private key added')
      await onChanged()
      setName('')
      setPrivateKeyPath('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add SSH key')
    } finally {
      setSaving(false)
    }
  }

  const copyPublicKey = async (key: SshPrivateKeyRecord) => {
    if (!key.publicKey) return
    await navigator.clipboard.writeText(key.publicKey)
    toast.success('Public key copied')
  }

  const deleteKey = async (key: SshPrivateKeyRecord) => {
    if (!workspaceId) return
    try {
      await window.electronAPI.deleteSshKey(workspaceId, key.id)
      toast.success('SSH key removed')
      await onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove SSH key')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> SSH Private Keys</DialogTitle>
          <DialogDescription>Manage local private key records. Craft Agent stores only the key path, public key, and fingerprint.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-[10px] border border-foreground/10 p-3">
            <div className="mb-2 text-[12px] font-medium text-muted-foreground">Add existing private key</div>
            <div className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
              <Input value={name} onChange={event => setName(event.target.value)} placeholder="Key name" />
              <Input value={privateKeyPath} onChange={event => setPrivateKeyPath(event.target.value)} placeholder="/Users/me/.ssh/id_ed25519" />
              <Button onClick={submit} disabled={saving || !name.trim() || !privateKeyPath.trim()}>Add Key</Button>
            </div>
          </div>

          <div className="space-y-2">
            {keys.length === 0 ? (
              <div className="rounded-[10px] bg-foreground/[0.03] p-4 text-sm text-muted-foreground">No private keys yet.</div>
            ) : keys.map(key => (
              <div key={key.id} className="rounded-[10px] border border-foreground/10 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{key.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{key.privateKeyPath}</div>
                    {key.fingerprint && <div className="mt-1 truncate text-[11px] text-muted-foreground">{key.fingerprint}</div>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyPublicKey(key)} disabled={!key.publicKey} title="Copy public key">
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteKey(key)} title="Remove key record">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SshProfileDialog({ open, onOpenChange, workspaceId, keys, profile, onChanged }: SshProfileDialogProps) {
  const [name, setName] = React.useState('')
  const [host, setHost] = React.useState('')
  const [port, setPort] = React.useState('22')
  const [username, setUsername] = React.useState('')
  const [privateKeyId, setPrivateKeyId] = React.useState('')
  const [remoteWorkingDirectory, setRemoteWorkingDirectory] = React.useState('')
  const [keepAlive, setKeepAlive] = React.useState(true)
  const [keepAliveMinutes, setKeepAliveMinutes] = React.useState('30')
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setName(profile?.name ?? '')
    setHost(profile?.host ?? '')
    setPort(String(profile?.port ?? 22))
    setUsername(profile?.username ?? '')
    setPrivateKeyId(profile?.privateKeyId ?? keys[0]?.id ?? '')
    setRemoteWorkingDirectory(profile?.remoteWorkingDirectory ?? '')
    setKeepAlive(profile?.keepAlive ?? true)
    setKeepAliveMinutes(String(profile?.keepAliveMinutes ?? 30))
  }, [keys, open, profile])

  const payload = () => ({
    name,
    host,
    port: Number(port || 22),
    username,
    privateKeyId,
    remoteWorkingDirectory,
    keepAlive,
    keepAliveMinutes: Number(keepAliveMinutes || 30),
  })

  const test = async () => {
    if (!workspaceId) return
    setTesting(true)
    try {
      const result = profile
        ? await window.electronAPI.testSshProfile(workspaceId, profile.id)
        : await window.electronAPI.testSshProfile(workspaceId, payload())
      if (result.ok) toast.success(`SSH connection OK${result.cwd ? `: ${result.cwd}` : ''}`)
      else toast.error(result.error || 'SSH connection failed')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'SSH connection failed')
    } finally {
      setTesting(false)
    }
  }

  const submit = async () => {
    if (!workspaceId) return
    setSaving(true)
    try {
      if (profile) {
        await window.electronAPI.updateSshProfile(workspaceId, profile.id, payload())
        toast.success('SSH host updated')
      } else {
        await window.electronAPI.createSshProfile(workspaceId, payload())
        toast.success('SSH host added')
      }
      await onChanged()
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save SSH host')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Server className="h-4 w-4" /> {profile ? 'Edit SSH Host' : 'Add SSH Host'}</DialogTitle>
          <DialogDescription>Configure a fixed SSH machine and working directory. This profile binds to one Craft Agent session.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={name} onChange={event => setName(event.target.value)} placeholder="Name" />
            <Input value={host} onChange={event => setHost(event.target.value)} placeholder="Host" />
          </div>
          <div className="grid gap-2 sm:grid-cols-[100px_1fr]">
            <Input value={port} onChange={event => setPort(event.target.value)} placeholder="22" />
            <Input value={username} onChange={event => setUsername(event.target.value)} placeholder="Username" />
          </div>
          <select
            value={privateKeyId}
            onChange={event => setPrivateKeyId(event.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
          >
            {keys.length === 0 ? <option value="">Add a private key first</option> : keys.map(key => (
              <option key={key.id} value={key.id}>{key.name} — {key.privateKeyPath}</option>
            ))}
          </select>
          <Input value={remoteWorkingDirectory} onChange={event => setRemoteWorkingDirectory(event.target.value)} placeholder="/home/ubuntu/project" />
          <div className="rounded-[10px] border border-foreground/10 p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={keepAlive}
                onChange={event => setKeepAlive(event.target.checked)}
                className="h-4 w-4 accent-accent"
              />
              <span>Keep SSH connection alive</span>
            </label>
            <div className="mt-2 grid gap-2 sm:grid-cols-[160px_1fr]">
              <Input
                value={keepAliveMinutes}
                onChange={event => setKeepAliveMinutes(event.target.value.replace(/[^0-9]/g, ''))}
                placeholder="30"
                disabled={!keepAlive}
              />
              <div className="self-center text-xs text-muted-foreground">
                Minutes to keep the OpenSSH control connection alive after the last command.
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onClick={test} disabled={testing || keys.length === 0 || !privateKeyId || !host.trim() || !username.trim() || !remoteWorkingDirectory.trim()}>
            {testing ? 'Testing…' : 'Test Connection'}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving || keys.length === 0 || !privateKeyId || !name.trim() || !host.trim() || !username.trim() || !remoteWorkingDirectory.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
