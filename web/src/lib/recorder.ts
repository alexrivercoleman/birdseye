// 15 s chunked recording (§7.1). MediaRecorder is stopped and restarted every chunk so each blob is an
// independently decodable file (with `timeslice`, only the first blob has headers). Small gaps are fine.
// Voice processing is off: echo cancellation / noise suppression / AGC are tuned for speech and hurt bird ID.

export const CHUNK_MS = 15_000
const TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']

export type Chunk = { blob: Blob; startedAt: string; durationS: number; mimeType: string }
export type MicStatus = 'starting' | 'recording' | 'interrupted' | 'denied' | 'error' | 'stopped'

export function pickMimeType(): string {
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
}

export class ChunkRecorder {
  private stream: MediaStream | null = null
  private rec: MediaRecorder | null = null
  private timer: number | undefined
  private stopping = false
  private onFinalStop: (() => void) | null = null

  constructor(
    private onChunk: (c: Chunk) => void,
    private onStatus: (s: MicStatus, detail?: string) => void,
  ) {}

  async start(): Promise<void> {
    this.stopping = false
    this.onStatus('starting')
    try {
      await this.ensureStream()
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      this.onStatus(denied ? 'denied' : 'error', String(e))
      return
    }
    if (this.stopping) {
      // stop() was called while the permission prompt was open
      this.stream?.getTracks().forEach((t) => t.stop())
      this.stream = null
      return
    }
    this.cycle()
  }

  /** Call when the page becomes visible again: iOS may have killed the mic while hidden. */
  async resume(): Promise<void> {
    if (this.stopping) return
    const live = this.stream?.getAudioTracks().some((t) => t.readyState === 'live')
    if (live && this.rec?.state === 'recording') return
    clearTimeout(this.timer)
    if (this.rec && this.rec.state !== 'inactive') {
      this.rec.onstop = null
      this.rec.stop()
    }
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    await this.start()
  }

  /** Stops recording; resolves after the final (partial) chunk has been emitted. */
  stop(): Promise<void> {
    this.stopping = true
    clearTimeout(this.timer)
    return new Promise((resolve) => {
      const done = () => {
        this.stream?.getTracks().forEach((t) => t.stop())
        this.stream = null
        this.onStatus('stopped')
        resolve()
      }
      if (this.rec && this.rec.state !== 'inactive') {
        this.onFinalStop = done
        this.rec.stop()
      } else {
        done()
      }
    })
  }

  private async ensureStream() {
    if (this.stream?.getAudioTracks().some((t) => t.readyState === 'live')) return
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
  }

  private cycle() {
    if (this.stopping || !this.stream) return
    if (!this.stream.getAudioTracks().some((t) => t.readyState === 'live')) {
      this.onStatus('interrupted')
      return
    }
    const mimeType = pickMimeType()
    const rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined)
    const started = new Date()
    const parts: Blob[] = []
    rec.ondataavailable = (e) => {
      if (e.data.size) parts.push(e.data)
    }
    rec.onstop = () => {
      const type = rec.mimeType || mimeType || 'audio/mp4'
      if (parts.length) {
        this.onChunk({
          blob: new Blob(parts, { type }),
          startedAt: started.toISOString(),
          durationS: (Date.now() - started.getTime()) / 1000,
          mimeType: type,
        })
      }
      if (this.onFinalStop) {
        const f = this.onFinalStop
        this.onFinalStop = null
        f()
      } else {
        this.cycle()
      }
    }
    rec.onerror = (e) => this.onStatus('error', String((e as ErrorEvent).error ?? e))
    rec.start()
    this.rec = rec
    this.onStatus('recording')
    this.timer = window.setTimeout(() => rec.state !== 'inactive' && rec.stop(), CHUNK_MS)
  }
}
