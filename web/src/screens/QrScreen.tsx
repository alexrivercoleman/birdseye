// §8 screen 9 QR codes. /qr shows your personal code (https://<app>/u/{username}); /qr?scan opens the in-app scanner.
// The scanner lives in the app because the iOS Camera app would open the link in Safari, not the installed PWA.
// Frames from the rear camera are decoded with jsQR (iOS Safari has no BarcodeDetector).
import jsQR from 'jsqr'
import QRCode from 'qrcode'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Avatar } from '../components/Avatar'
import { LevelTag } from '../components/LevelTag'
import { useAuth } from '../lib/auth'

const SCAN_PX = 640 // decode frames downscaled to this long edge
const SCAN_EVERY_MS = 150

export const profileLink = (username: string) => `${window.location.origin}/u/${username}`

/** The username in a Birdseye profile link (any host, so codes from the deployed app work in dev too). */
export function usernameFromQr(text: string): string | null {
  try {
    return new URL(text.trim()).pathname.match(/^\/u\/([a-z0-9_]{3,20})\/?$/i)?.[1].toLowerCase() ?? null
  } catch {
    return null
  }
}

export default function QrScreen() {
  const [params, setParams] = useSearchParams()
  const scanning = params.has('scan')
  const navigate = useNavigate()
  const onScanned = useCallback(
    (username: string) => {
      navigator.vibrate?.(40)
      navigate(`/u/${username}`, { replace: true })
    },
    [navigate],
  )

  const tab = (scan: boolean, label: string) => (
    <button
      type="button"
      onClick={() => setParams(scan ? { scan: '' } : {}, { replace: true })}
      className={`flex-1 rounded-xl py-2 text-sm font-semibold ${scanning === scan ? 'bg-white text-forest shadow-sm' : 'text-bark/60'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-4 px-4 pb-8 pt-5">
      <div className="flex gap-1 rounded-2xl bg-forest/5 p-1">
        {tab(false, 'My code')}
        {tab(true, 'Scan')}
      </div>
      {scanning ? <Scanner onScanned={onScanned} /> : <MyCode />}
    </div>
  )
}

function MyCode() {
  const me = useAuth().profile!
  const link = profileLink(me.username)
  const [svg, setSvg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    QRCode.toString(link, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#1f3d2b', light: '#ffffff' } })
      .then(setSvg)
      .catch(() => setSvg(null))
  }, [link])

  async function share() {
    if (navigator.share) {
      await navigator.share({ title: 'Follow me on Birdseye', url: link }).catch(() => {})
    } else {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <section className="rounded-3xl bg-white p-6 text-center shadow-sm">
      <div className="flex flex-col items-center">
        <Avatar user={me} size={64} />
        <p className="mt-2 text-xl font-bold text-forest">{me.display_name ?? me.username}</p>
        <p className="text-sm text-bark/60">@{me.username}</p>
        <LevelTag xp={me.xp} className="mt-1.5" />
      </div>
      {/* SVG generated locally by the qrcode library from our own URL. */}
      <div className="mx-auto mt-5 aspect-square w-full max-w-64 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} />
      <p className="mt-4 text-sm text-bark/60">Friends scan this in Birdseye to find and follow you.</p>
      <button type="button" onClick={() => void share()} className="mt-4 w-full rounded-xl bg-forest py-2.5 text-sm font-semibold text-paper active:scale-95">
        {copied ? 'Link copied' : 'Share profile link'}
      </button>
    </section>
  )
}

function Scanner({ onScanned }: { onScanned: (username: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const onScannedRef = useRef(onScanned)
  onScannedRef.current = onScanned
  const [error, setError] = useState<string | null>(null)
  const [foreign, setForeign] = useState(false) // saw a QR code that isn't a Birdseye profile

  useEffect(() => {
    let stopped = false
    let stream: MediaStream | null = null
    let timer = 0
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!

    const tick = () => {
      if (stopped) return
      const v = video.current
      if (v && v.readyState >= v.HAVE_CURRENT_DATA && v.videoWidth) {
        const scale = Math.min(1, SCAN_PX / Math.max(v.videoWidth, v.videoHeight))
        const w = (canvas.width = Math.round(v.videoWidth * scale))
        const h = (canvas.height = Math.round(v.videoHeight * scale))
        ctx.drawImage(v, 0, 0, w, h)
        const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })
        if (code?.data) {
          const username = usernameFromQr(code.data)
          if (username) {
            stopped = true
            return onScannedRef.current(username)
          }
          setForeign(true)
        }
      }
      timer = window.setTimeout(tick, SCAN_EVERY_MS)
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser can’t open the camera here (it needs HTTPS).')
    } else {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        .then(async (s) => {
          if (stopped) return s.getTracks().forEach((t) => t.stop())
          stream = s
          const v = video.current!
          v.srcObject = s
          await v.play()
          tick()
        })
        .catch((e: DOMException) =>
          setError(
            e.name === 'NotAllowedError'
              ? 'Camera access is blocked. Allow it for Birdseye in Settings, then try again.'
              : `Can’t open the camera: ${e.message || e.name}`,
          ),
        )
    }
    return () => {
      stopped = true
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <section className="space-y-3">
      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-3xl bg-black">
        <video ref={video} playsInline muted className="h-full w-full object-cover" />
        {!error && (
          <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
        )}
        {error && <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white">{error}</p>}
      </div>
      <p className="text-center text-sm text-bark/60">
        {foreign ? 'That QR code isn’t a Birdseye profile.' : 'Point the camera at a friend’s Birdseye code.'}
      </p>
      <p className="text-center text-xs text-bark/50">
        Or <Link to="/search" className="font-semibold text-forest underline">search by username</Link>.
      </p>
    </section>
  )
}
