import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Placeholder values keep the app booting in mock mode before Supabase is configured.
export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'public-anon-key')
