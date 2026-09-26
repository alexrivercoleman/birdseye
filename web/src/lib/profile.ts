// Editing your own profile goes straight to Supabase (RLS: owner only; xp is not client-writable). Avatars live in
// the public `avatars` bucket under "<user id>/", cropped to a 256 px square JPEG in the browser first.
import { USE_MOCKS } from '../api/client'
import { supabase } from './supabase'

const AVATAR_PX = 256

export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const img = await createImageBitmap(file)
  const side = Math.min(img.width, img.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = AVATAR_PX
  canvas
    .getContext('2d')!
    .drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX)
  img.close()
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read that image'))), 'image/jpeg', 0.85),
  )
  if (USE_MOCKS) return URL.createObjectURL(blob)

  // A new name per upload, so browsers and the CDN never serve the old picture.
  const path = `${userId}/${Date.now()}.jpg`
  const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw error
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
}

export async function updateProfile(
  userId: string,
  fields: { display_name?: string | null; bio?: string | null; avatar_url?: string | null },
) {
  if (USE_MOCKS) return
  const { error } = await supabase.from('profiles').update(fields).eq('id', userId)
  if (error) throw error
}
