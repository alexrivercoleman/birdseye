import { lazy, Suspense } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router'
import { USE_MOCKS } from './api/client'
import { useAuth } from './lib/auth'
import { AuthScreen, UsernameScreen } from './screens/AuthScreen'
import { FeedScreen, MapScreen, ProfileScreen, QuestsScreen } from './screens/placeholders'
import WalkScreen from './screens/WalkScreen'

const RecapScreen = lazy(() => import('./screens/RecapScreen')) // mapbox-gl is big; load it on demand

const tabs = [
  { to: '/feed', label: 'Feed' },
  { to: '/map', label: 'Map' },
  { to: '/walk', label: 'Walk' },
  { to: '/quests', label: 'Quests' },
  { to: '/profile', label: 'Profile' },
]

export default function App() {
  const { session, profile, loading } = useAuth()
  if (loading) return null
  if (!session) return <AuthScreen />
  if (!profile) return <UsernameScreen />

  return (
    <div className="flex h-full flex-col pt-[env(safe-area-inset-top)]">
      {USE_MOCKS && <div className="bg-rare px-3 py-1 text-center text-xs font-semibold text-bark">MOCK API</div>}
      <main className="flex-1 overflow-y-auto">
        <Suspense fallback={<p className="p-6 text-bark/60">Loading…</p>}>
        <Routes>
          <Route path="/" element={<Navigate to="/walk" replace />} />
          <Route path="/feed" element={<FeedScreen />} />
          <Route path="/map" element={<MapScreen />} />
          <Route path="/walk" element={<WalkScreen />} />
          <Route path="/walks/:walkId" element={<RecapScreen />} />
          <Route path="/quests" element={<QuestsScreen />} />
          <Route path="/profile" element={<ProfileScreen />} />
          <Route path="/u/:username" element={<ProfileScreen />} />
        </Routes>
        </Suspense>
      </main>
      <nav className="grid grid-cols-5 border-t border-forest/10 bg-paper pb-[env(safe-area-inset-bottom)]">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              `py-3 text-center text-sm font-medium ${isActive ? 'text-forest' : 'text-bark/50'}`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
