// Persistent upload queue (§7.1): everything a walk produces goes to IndexedDB first, then uploads in order with
// retry + backoff, so bad trail signal or an app reload loses nothing. Blobs are stored as ArrayBuffers
// (older iOS WebKit had trouble persisting Blobs in IndexedDB).
import { ApiError, api } from '../api/client'
import type { TrackPoint } from '../api/types'

export type QueueItem =
  | { kind: 'track'; walkId: string; points: TrackPoint[] }
  | {
      kind: 'chunk'
      walkId: string
      data: ArrayBuffer
      chunkIndex: number
      startedAt: string
      durationS: number
      mimeType: string
    }
  | {
      kind: 'photo'
      walkId: string
      data: ArrayBuffer
      mimeType: string
      capturedAt: string
      lat: number
      lng: number
      localId: string
    }

type Stored = QueueItem & { id: number; attempts: number }

const DB_NAME = 'birdseye'
const STORE = 'uploads'
let dbPromise: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE)
  return new Promise((resolve, reject) => {
    const req = fn(store)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const all = () => run<Stored[]>('readonly', (s) => s.getAll())

async function first(): Promise<Stored | undefined> {
  const cursor = await run<IDBCursorWithValue | null>('readonly', (s) => s.openCursor())
  return cursor?.value as Stored | undefined
}

// ---- listeners ------------------------------------------------------------

type Counts = Record<string, { chunks: number; photos: number; total: number }>
const countListeners = new Set<(c: Counts) => void>()
const photoListeners = new Set<(localId: string, photoId: string) => void>()

export function onCounts(fn: (c: Counts) => void): () => void {
  countListeners.add(fn)
  void notify()
  return () => countListeners.delete(fn)
}

export function onPhotoUploaded(fn: (localId: string, photoId: string) => void): () => void {
  photoListeners.add(fn)
  return () => photoListeners.delete(fn)
}

async function counts(): Promise<Counts> {
  const c: Counts = {}
  for (const item of await all()) {
    const w = (c[item.walkId] ??= { chunks: 0, photos: 0, total: 0 })
    w.total++
    if (item.kind === 'chunk') w.chunks++
    if (item.kind === 'photo') w.photos++
  }
  return c
}

async function notify() {
  const c = await counts()
  countListeners.forEach((fn) => fn(c))
}

// ---- processing -----------------------------------------------------------

export async function enqueue(item: QueueItem): Promise<void> {
  await run('readwrite', (s) => s.add({ ...item, attempts: 0 }))
  void notify()
  void kick()
}

async function send(item: Stored): Promise<void> {
  if (item.kind === 'track') {
    await api.postTrack(item.walkId, item.points)
  } else if (item.kind === 'chunk') {
    const form = new FormData()
    const ext = item.mimeType.includes('mp4') ? 'm4a' : item.mimeType.includes('ogg') ? 'ogg' : 'webm'
    form.append('file', new Blob([item.data], { type: item.mimeType }), `${item.chunkIndex}.${ext}`)
    form.append('chunk_index', String(item.chunkIndex))
    form.append('started_at', item.startedAt)
    form.append('duration_s', String(item.durationS))
    form.append('mime_type', item.mimeType)
    await api.uploadChunk(item.walkId, form)
  } else {
    const form = new FormData()
    form.append('file', new Blob([item.data], { type: item.mimeType }), 'photo.jpg')
    form.append('captured_at', item.capturedAt)
    form.append('lat', String(item.lat))
    form.append('lng', String(item.lng))
    const { photo_id } = await api.uploadPhoto(item.walkId, form)
    photoListeners.forEach((fn) => fn(item.localId, photo_id))
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let running = false

export async function kick(): Promise<void> {
  if (running) return
  running = true
  try {
    for (let item = await first(); item; item = await first()) {
      try {
        await send(item)
        await run('readwrite', (s) => s.delete(item!.id))
      } catch (e) {
        const permanent = e instanceof ApiError && e.status >= 400 && e.status < 500 && ![408, 429].includes(e.status)
        if (permanent) {
          console.warn('upload rejected, dropping', item.kind, e)
          await run('readwrite', (s) => s.delete(item!.id))
        } else {
          item.attempts++
          await run('readwrite', (s) => s.put(item!))
          await sleep(Math.min(30_000, 1000 * 2 ** item.attempts))
        }
      }
      void notify()
    }
  } finally {
    running = false
    void notify()
  }
}

export async function pendingFor(walkId: string): Promise<number> {
  return (await counts())[walkId]?.total ?? 0
}

export async function drain(walkId: string, onProgress?: (n: number) => void): Promise<void> {
  for (;;) {
    const n = await pendingFor(walkId)
    onProgress?.(n)
    if (n === 0) return
    void kick()
    await sleep(700)
  }
}

window.addEventListener('online', () => void kick())
void kick()
