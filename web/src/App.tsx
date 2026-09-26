import { lazy, Suspense } from 'react'
import { Link, NavLink, Navigate, Route, Routes } from 'react-router'
import { USE_MOCKS } from './api/client'
import birdLogo from './assets/logo/bird.png'
import wordmark from './assets/logo/wordmark.png'
import { Avatar } from './components/Avatar'
import { useAuth } from './lib/auth'
import { AuthScreen, UsernameScreen } from './screens/AuthScreen'
import FeedScreen from './screens/FeedScreen'
import { MapScreen, ProfileScreen } from './screens/placeholders'
import QuestsScreen from './screens/QuestsScreen'
import WalkScreen from './screens/WalkScreen'

const RecapScreen = lazy(() => import('./screens/RecapScreen')) // mapbox-gl is big; load it on demand

// Profile lives behind the avatar in the header, not a tab. /map has no entry point yet. Walk (which also holds the
// community map) is the bird logo in the middle.
const tabs = [
  { to: '/feed', label: 'Feed' },
  { to: '/walk', label: 'Walk', logo: true },
  { to: '/quests', label: 'Quests' },
]

export default function App() {
  const { session, profile, loading } = useAuth()
  if (loading) return null
  if (!session) return <AuthScreen />
  if (!profile) return <UsernameScreen />

  return (
    <div className="flex h-full flex-col pt-[env(safe-area-inset-top)]">
      {USE_MOCKS && <div className="bg-rare px-3 py-1 text-center text-xs font-semibold text-bark">MOCK API</div>}
      <header className="flex items-center justify-between border-b border-forest/10 px-4 py-1.5">
        <Link to="/walk" aria-label="Birdseye home" className="active:scale-95">
          <img src={wordmark} alt="Birdseye" className="h-11 w-auto" />
        </Link>
        <NavLink
          to="/profile"
          aria-label="Profile"
          className={({ isActive }) =>
            `rounded-full active:scale-95 ${isActive ? 'ring-2 ring-forest ring-offset-2 ring-offset-paper' : ''}`
          }
        >
          <Avatar user={profile} />
        </NavLink>
      </header>
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
      <nav className="grid grid-cols-3 border-t border-forest/10 bg-paper pb-[env(safe-area-inset-bottom)]">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            aria-label={t.label}
            className={({ isActive }) =>
              `flex h-14 items-center justify-center text-sm font-medium ${isActive ? 'text-forest' : 'text-bark/50'}`
            }
          >
            {({ isActive }) =>
              t.logo ? (
                <img
                  src={birdLogo}
                  alt=""
                  className={`h-10 w-auto transition ${isActive ? 'scale-110' : 'opacity-60 grayscale-[60%]'}`}
                />
              ) : (
                t.label
              )
            }
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
