import { ReactNode, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { NotificationBell } from '../../features/notifications/components/NotificationBell'
import { useSession } from '../../providers/SessionProvider'

interface AppShellProps {
  children: ReactNode
}

// ── Inline SVG icon primitive ─────────────────────────────────────────────────

function Ico({ d, className = 'h-4 w-4' }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const D = {
  dashboard: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  workflow:  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  execution: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  task:      'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  event:     'M13 10V3L4 14h7v7l9-11h-7z',
  metric:    'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  kpi:       'M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
  notif:     'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  audit:     'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  teams:     'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
  org:       'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  settings:  'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  logout:    'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
  menu:      'M4 6h16M4 12h16M4 18h16',
  x:         'M6 18L18 6M6 6l12 12',
  chevron:   'M19 9l-7 7-7-7',
}

// ── Nav section + item ────────────────────────────────────────────────────────

function NavSection({ label }: { label: string }) {
  return (
    <p className="mb-1 mt-4 px-3 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
      {label}
    </p>
  )
}

function NavItem({ to, icon, label, onClick }: { to: string; icon: string; label: string; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-blue-600 text-white'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
        }`
      }
    >
      <Ico d={D[icon as keyof typeof D] ?? D.dashboard} className="h-4 w-4 flex-shrink-0" />
      {label}
    </NavLink>
  )
}

// ── AppShell ──────────────────────────────────────────────────────────────────

export function AppShell({ children }: AppShellProps) {
  const { user, role, logout } = useSession()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const close = () => setSidebarOpen(false)

  const roleLabels: Record<string, string> = {
    owner: 'Owner', admin: 'Admin',
    operations_manager: 'Ops Manager',
    team_lead: 'Team Lead', member: 'Member',
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const initial = user?.fullName?.charAt(0)?.toUpperCase() ?? '?'

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-gray-900/40 lg:hidden" onClick={close} aria-hidden="true" />
      )}

      {/* ── Sidebar ──────────────────────────────────────────── */}
      <aside className={`fixed inset-y-0 left-0 z-30 flex w-52 flex-col border-r border-gray-200 bg-white transition-transform duration-200 lg:static lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Logo */}
        <div className="flex h-12 items-center gap-2 border-b border-gray-100 px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600">
            <span className="text-xs font-bold text-white">O</span>
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold text-gray-900">OpsCore</p>
            <p className="text-[10px] text-gray-400">Operations Platform</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label="Primary navigation">
          <NavSection label="Platform" />
          <NavItem to="/dashboard" icon="dashboard" label="Dashboard" onClick={close} />
          <NavItem to="/workflows" icon="workflow" label="Workflows" onClick={close} />
          <NavItem to="/executions" icon="execution" label="Executions" onClick={close} />
          <NavItem to="/tasks" icon="task" label="Tasks" onClick={close} />
          <NavItem to="/events" icon="event" label="Events" onClick={close} />
          <NavItem to="/metrics" icon="metric" label="Metrics" onClick={close} />
          <NavItem to="/kpis" icon="kpi" label="KPIs" onClick={close} />
          <NavItem to="/notifications" icon="notif" label="Notifications" onClick={close} />

          <NavSection label="Governance" />
          <NavItem to="/audit-logs" icon="audit" label="Audit Logs" onClick={close} />
          <NavItem to="/teams" icon="teams" label="Teams" onClick={close} />
          <NavItem to="/organizations" icon="org" label="Organizations" onClick={close} />

          <NavSection label="System" />
          <NavItem to="/settings" icon="settings" label="Settings" onClick={close} />
        </nav>

        {/* User footer */}
        <div className="border-t border-gray-100 px-2 py-2">
          <div className="mb-1 flex items-center gap-2 rounded-md px-2 py-1.5">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-xs font-bold text-white">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-gray-900">{user?.fullName ?? '—'}</p>
              <p className="truncate text-[10px] text-gray-400">{role ? roleLabels[role] : ''}</p>
            </div>
          </div>
          <button
            onClick={() => { void handleLogout() }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
            aria-label="Log out"
          >
            <Ico d={D.logout} />
            Log out
          </button>
        </div>
      </aside>

      {/* ── Main area ─────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <header className="flex h-12 flex-shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 shadow-sm">
          <button
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 lg:hidden"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle navigation"
          >
            <Ico d={sidebarOpen ? D.x : D.menu} className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <NotificationBell />
        </header>

        {/* Page */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
