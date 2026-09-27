import { useState, type FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import wordmark from '../assets/logo/wordmark.png'

const input =
  'w-full rounded-xl border border-forest/20 bg-white px-4 py-3 text-base outline-none focus:border-forest'
const button = 'w-full rounded-xl bg-forest py-3.5 text-base font-semibold text-paper disabled:opacity-50'

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col justify-center px-6 pt-[env(safe-area-inset-top)]">
      <h1>
        <img src={wordmark} alt="Birdseye" className="h-24 w-auto" />
      </h1>
      <p className="mb-8 mt-2 text-bark/70">Hear every bird on your walk</p>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mb-5 text-sm text-bark/60">{subtitle}</p>
      {children}
    </div>
  )
}

export function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })
    setBusy(false)
    if (error) setError(error.message)
  }

  return (
    <Shell
      title={mode === 'signin' ? 'Sign in' : 'Create an account'}
      subtitle="Go on a walk, your phone listens, and AI identifies every bird you hear."
    >
      <form onSubmit={submit} className="space-y-3">
        <input className={input} type="email" autoComplete="email" placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)} required />
        <input className={input} type="password" placeholder="Password (6+ characters)" minLength={6}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password}
          onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button className={button} disabled={busy}>{busy ? '…' : mode === 'signin' ? 'Sign in' : 'Sign up'}</button>
      </form>
      <button className="mt-4 text-sm font-medium text-moss" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
        {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
      </button>
    </Shell>
  )
}

export function UsernameScreen() {
  const { session, reloadProfile, signOut } = useAuth()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const valid = /^[a-z0-9_]{3,20}$/.test(username)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase
      .from('profiles')
      .insert({ id: session!.user.id, username, display_name: displayName || username })
    setBusy(false)
    if (error) return setError(error.code === '23505' ? 'That username is taken.' : error.message)
    await reloadProfile()
  }

  return (
    <Shell title="Pick a username" subtitle="3–20 characters: lowercase letters, numbers, underscores.">
      <form onSubmit={submit} className="space-y-3">
        <input className={input} placeholder="username" autoCapitalize="none" autoCorrect="off" value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())} required />
        <input className={input} placeholder="Display name (optional)" value={displayName}
          onChange={(e) => setDisplayName(e.target.value)} />
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button className={button} disabled={busy || !valid}>Continue</button>
      </form>
      <button className="mt-4 text-sm text-bark/60" onClick={() => void signOut()}>Sign out</button>
    </Shell>
  )
}
