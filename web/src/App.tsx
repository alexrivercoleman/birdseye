import { lazy, Suspense, useEffect } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router'
import { USE_MOCKS } from './api/client'
import birdLogo from './assets/logo/bird.png'
import wordmark from './assets/logo/wordmark.png'
import { Avatar } from './components/Avatar'
import { LevelUpToast } from './components/LevelUpToast'
import { useAuth } from './lib/auth'
import { levelInfo } from './lib/levels'
import { AuthScreen, UsernameScreen } from './screens/AuthScreen'
import FeedScreen from './screens/FeedScreen'
import FollowListScreen from './screens/FollowListScreen'
import { MapScreen } from './screens/placeholders'
import ProfileScreen from './screens/ProfileScreen'
import QuestsScreen from './screens/QuestsScreen'
import SearchScreen from './screens/SearchScreen'
import WalkScreen from './screens/WalkScreen'

const RecapScreen = lazy(() => import('./screens/RecapScreen')) // mapbox-gl is big; load it on demand
const QrScreen = lazy(() => import('./screens/QrScreen')) // jsQR + qrcode, only needed here

// Profile lives behind the avatar in the header, not a tab. /map has no entry point yet. Walk (which also holds the
// community map) is the bird logo in the middle.
const tabs = [
  { to: '/feed', label: 'Feed' },
  { to: '/walk', label: 'Walk', logo: true },
  { to: '/quests', label: 'Quests' },
]

export default function App() {
  const { session, profile, loading, reloadProfile } = useAuth()
  const { pathname } = useLocation()
  // XP changes server-side (finished walks, claims); a one-row reload per navigation keeps the header level fresh.
  useEffect(() => {
    if (session) void reloadProfile()
  }, [pathname])
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
        <div className="flex items-center gap-3">
          <NavLink
            to="/search"
            aria-label="Find birders"
            className={({ isActive }) => `p-1 active:scale-95 ${isActive ? 'text-forest' : 'text-bark/60'}`}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </NavLink>
          <NavLink
            to="/profile"
            aria-label={`Profile, level ${levelInfo(profile.xp).level}`}
            className={({ isActive }) =>
              `relative rounded-full active:scale-95 ${isActive ? 'ring-2 ring-forest ring-offset-2 ring-offset-paper' : ''}`
            }
          >
            <Avatar user={profile} />
            <span className="absolute -bottom-1 -right-1.5 min-w-5 rounded-full border-2 border-paper bg-forest px-1 text-center text-[10px] font-bold leading-4 text-paper tabular-nums">
              {levelInfo(profile.xp).level}
            </span>
          </NavLink>
        </div>
      </header>
      <LevelUpToast xp={profile.xp} />
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
          <Route path="/u/:username/followers" element={<FollowListScreen kind="followers" />} />
          <Route path="/u/:username/following" element={<FollowListScreen kind="following" />} />
          <Route path="/search" element={<SearchScreen />} />
          <Route path="/qr" element={<QrScreen />} />
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
