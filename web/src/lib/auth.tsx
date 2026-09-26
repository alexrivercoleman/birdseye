// Session + profile. Auth is email + password with "Confirm email" off (see docs/CONTRACT_CHANGES.md).
import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { USE_MOCKS } from '../api/client'
import { demoUser } from '../api/mocks'
import type { UserRef } from '../api/types'
import { supabase } from './supabase'

export type MyProfile = UserRef & { bio: string | null }

type AuthState = {
  session: Session | null
  profile: MyProfile | null
  loading: boolean
  reloadProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<MyProfile | null>(null)
  const [loading, setLoading] = useState(!USE_MOCKS)

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) return setProfile(null)
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, xp, bio')
      .eq('id', s.user.id)
      .maybeSingle()
    // A failed reload (flaky network) keeps the profile we have; only "no row" means pick a username.
    if (!error) setProfile(data)
  }, [])

  useEffect(() => {
    if (USE_MOCKS) return
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await loadProfile(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      void loadProfile(s)
    })
    return () => data.subscription.unsubscribe()
  }, [loadProfile])

  const reloadProfile = useCallback(() => loadProfile(session), [loadProfile, session])

  const value: AuthState = USE_MOCKS
    ? {
        session: {} as Session,
        profile: { ...demoUser, bio: 'Dawn chorus regular at Piedmont Park. Still chasing a Pileated photo.' },
        loading: false,
        reloadProfile: async () => {},
        signOut: async () => {},
      }
    : {
        session,
        profile,
        loading,
        reloadProfile,
        signOut: async () => {
          await supabase.auth.signOut()
        },
      }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
