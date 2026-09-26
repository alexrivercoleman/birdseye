// Keep the screen on during a walk (§7.1). The lock is dropped whenever the page is hidden, so re-request it
// on visibilitychange. TODO(verify on the demo iPhone): Wake Lock in standalone home-screen mode needs a recent
// iOS; if it doesn't hold there, fall back to the NoSleep.js silent-video trick.
import { useEffect, useState } from 'react'

export type WakeStatus = 'on' | 'off' | 'unsupported'

export function useWakeLock(active: boolean): WakeStatus {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator
  const [status, setStatus] = useState<WakeStatus>(supported ? 'off' : 'unsupported')

  useEffect(() => {
    if (!active || !supported) return
    let sentinel: WakeLockSentinel | null = null
    let cancelled = false
    const acquire = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        sentinel = await navigator.wakeLock.request('screen')
        if (cancelled) return void sentinel.release()
        setStatus('on')
        sentinel.addEventListener('release', () => setStatus('off'))
      } catch {
        setStatus('off')
      }
    }
    void acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', acquire)
      void sentinel?.release()
    }
  }, [active, supported])

  return status
}
