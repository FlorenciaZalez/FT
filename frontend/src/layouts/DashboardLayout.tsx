import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Boxes,
  ChevronRight,
  LayoutDashboard,
  Plug,
  Receipt,
  Settings,
  ShoppingBag,
  Truck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import UserMenu from '../components/UserMenu';
import { fetchAlerts } from '../services/alerts';
import type { Alert } from '../services/alerts';

const ALERTS_LAST_SEEN_KEY = 'alerts_last_seen_at';

type SidebarBadge = {
  value: number | string;
  tone?: 'primary' | 'warning';
};

type SidebarChild = {
  label: string;
  path: string;
  adminOnly?: boolean;
  badge?: SidebarBadge;
};

type SidebarLeaf = {
  type: 'item';
  key: string;
  label: string;
  path: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  badge?: SidebarBadge;
};

type SidebarGroup = {
  type: 'section';
  key: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  badge?: SidebarBadge;
  children: SidebarChild[];
};

type SidebarEntry = SidebarLeaf | SidebarGroup;

export type DashboardLayoutContext = {
  activeAlertCount: number;
  visibleAlertNoticeCount: number;
  openAlertsPanel: () => Promise<void>;
};

function getStoredAlertsLastSeen(): string | null {
  try {
    return window.localStorage.getItem(ALERTS_LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

function setStoredAlertsLastSeen(value: string): void {
  try {
    window.localStorage.setItem(ALERTS_LAST_SEEN_KEY, value);
  } catch {
    // ignore storage failures
  }
}

function hasAlertsToReview(alerts: Alert[], lastSeenAt: string | null): boolean {
  if (alerts.length === 0) return false;
  if (!lastSeenAt) return true;
  const lastSeenMs = Date.parse(lastSeenAt);
  if (Number.isNaN(lastSeenMs)) return true;
  return alerts.some((alert) => Date.parse(alert.created_at) > lastSeenMs);
}

function isPathActive(currentPath: string, targetPath: string): boolean {
  return currentPath === targetPath || currentPath.startsWith(`${targetPath}/`);
}

function isEntryActive(entry: SidebarEntry, currentPath: string): boolean {
  return entry.type === 'item'
    ? isPathActive(currentPath, entry.path)
    : entry.children.some((child) => isPathActive(currentPath, child.path));
}

function getBadgeClasses(tone: SidebarBadge['tone'] = 'primary'): string {
  return tone === 'warning'
    ? 'bg-yellow-100 text-yellow-800'
    : 'bg-blue-50 text-blue-700';
}

type SidebarItemProps = {
  label: string;
  path: string;
  badge?: SidebarBadge;
  nested?: boolean;
  icon?: LucideIcon;
  collapsed?: boolean;
  overlay?: boolean;
  index?: number;
  onSelect?: () => void;
};

function SidebarItem({
  label,
  path,
  badge,
  nested = false,
  icon: Icon,
  collapsed = false,
  overlay = false,
  index = 0,
  onSelect,
}: SidebarItemProps) {
  const itemStyle = overlay
    ? ({
        transitionDelay: `${index * 40}ms`,
        animationDelay: `${index * 40}ms`,
      } satisfies CSSProperties)
    : undefined;
  const isTopLevel = !nested;

  return (
    <NavLink
      to={path}
      style={itemStyle}
      onClick={onSelect}
      className={({ isActive }) =>
        [
          'group relative overflow-hidden border-l-2 text-sm ease-out',
          nested
            ? 'ml-3 flex items-center justify-between rounded-lg px-3 py-2 pl-4 transition-[background-color,color,box-shadow] duration-200'
            : 'flex h-12 w-full items-center rounded-xl transition-[background-color,color,box-shadow] duration-200',
          overlay && !collapsed ? 'animate-[fade-slide-in_360ms_ease-out_both]' : '',
          isActive
            ? 'border-transparent bg-blue-50/90 text-blue-700 shadow-[0_8px_24px_rgba(79,109,255,0.16)]'
            : overlay
              ? 'border-transparent text-gray-900 hover:bg-white/40 hover:text-gray-900 hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]'
              : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-900',
        ].join(' ')
      }
      title={collapsed ? label : undefined}
    >
      {({ isActive }) => (
        <>
          {overlay && (
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/35 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
          )}
          {isActive && !collapsed && (
            <span className="pointer-events-none absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-blue-600 shadow-[0_0_8px_rgba(79,109,255,0.6)]" />
          )}
          {isTopLevel ? (
            <>
              {Icon && (
                <span className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl bg-gray-50 text-current transition-[background-color,color] duration-200 group-hover:bg-white group-hover:text-blue-700">
                  <Icon size={22} strokeWidth={2.1} />
                </span>
              )}
              <span className="relative z-10 flex w-full items-center justify-between pl-[52px] pr-3">
                <span
                  className={[
                    'min-w-0 overflow-hidden transition-[opacity,transform,max-width] duration-200 ease-out',
                    collapsed ? 'max-w-0 -translate-x-2 opacity-0' : 'max-w-[140px] translate-x-0 opacity-100',
                  ].join(' ')}
                >
                  <span className="block truncate font-medium whitespace-nowrap">{label}</span>
                </span>
                {badge && (
                  <span
                    className={[
                      `shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${getBadgeClasses(badge.tone)}`,
                      collapsed ? 'pointer-events-none opacity-0' : 'opacity-100 transition-opacity duration-200 ease-out',
                    ].join(' ')}
                  >
                    {badge.value}
                  </span>
                )}
              </span>
            </>
          ) : (
            <>
              <span className="relative z-10 flex min-w-0 items-center gap-3">
                {Icon && (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-current transition-[background-color,color] duration-200 group-hover:bg-white group-hover:text-blue-700">
                    <Icon size={16} strokeWidth={2.1} />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate font-medium">{label}</span>
                </span>
              </span>
              {badge && !collapsed && (
                <span className={`relative z-10 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${getBadgeClasses(badge.tone)}`}>
                  {badge.value}
                </span>
              )}
            </>
          )}
        </>
      )}
    </NavLink>
  );
}

type SidebarSectionProps = {
  entry: SidebarGroup;
  currentPath: string;
  isOpen: boolean;
  onToggle: (key: string) => void;
  collapsed?: boolean;
  overlay?: boolean;
  index?: number;
  onItemSelect?: () => void;
};

function SidebarSection({
  entry,
  currentPath,
  isOpen,
  onToggle,
  collapsed = false,
  overlay = false,
  index = 0,
  onItemSelect,
}: SidebarSectionProps) {
  const isSectionActive = entry.children.some((child) => isPathActive(currentPath, child.path));
  const Icon = entry.icon;
  const sectionStyle = overlay
    ? ({
        transitionDelay: `${index * 40}ms`,
        animationDelay: `${index * 40}ms`,
      } satisfies CSSProperties)
    : undefined;

  return (
    <div className={`space-y-1 ${overlay && !collapsed ? 'animate-[fade-slide-in_360ms_ease-out_both]' : ''}`} style={sectionStyle}>
      <button
        type="button"
        onClick={() => onToggle(entry.key)}
        className={[
          'group relative flex h-12 w-full items-center overflow-hidden rounded-xl border border-transparent text-left transition-[background-color,color,box-shadow] duration-200 ease-out',
          isSectionActive
            ? 'bg-blue-50/80 text-blue-700 shadow-[0_8px_24px_rgba(79,109,255,0.14)]'
            : overlay
              ? 'text-gray-900 hover:bg-white/40 hover:text-gray-900 hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]'
              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900',
        ].join(' ')}
        title={collapsed ? entry.label : undefined}
      >
        {isSectionActive && !collapsed && (
          <span className="pointer-events-none absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-blue-600 shadow-[0_0_8px_rgba(79,109,255,0.6)]" />
        )}
        {overlay && (
          <span className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/35 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
        )}
        <span className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl bg-gray-50 text-current transition-[background-color,color] duration-200 group-hover:bg-white group-hover:text-blue-700">
          <Icon size={22} strokeWidth={2.1} />
        </span>
        <span className="relative z-10 flex w-full items-center justify-between pl-[52px] pr-3">
          <span
            className={[
              'min-w-0 overflow-hidden transition-[opacity,transform,max-width] duration-200 ease-out',
              collapsed ? 'max-w-0 -translate-x-2 opacity-0' : 'max-w-[140px] translate-x-0 opacity-100',
            ].join(' ')}
          >
            <span className="block truncate text-sm font-semibold leading-none whitespace-nowrap">{entry.label}</span>
          </span>
          <span
            className={[
              'flex items-center gap-2 transition-[opacity,transform,max-width] duration-200 ease-out',
              collapsed ? 'pointer-events-none max-w-0 translate-x-1 opacity-0' : 'max-w-[96px] translate-x-0 opacity-100',
            ].join(' ')}
          >
            {entry.badge && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${getBadgeClasses(entry.badge.tone)}`}>
                {entry.badge.value}
              </span>
            )}
            <ChevronRight
              size={16}
              className={`shrink-0 transition-transform duration-200 ease-in-out ${isOpen ? 'rotate-90' : 'rotate-0'}`}
            />
          </span>
        </span>
      </button>

      <div
        className={[
          'overflow-hidden transition-all duration-200 ease-in-out',
          collapsed ? 'max-h-0 opacity-0' : isOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0',
        ].join(' ')}
      >
        <div className="space-y-1 pb-1">
          {entry.children.map((child, childIndex) => (
            <SidebarItem
              key={child.path}
              label={child.label}
              path={child.path}
              badge={child.badge}
              nested
              collapsed={collapsed}
              overlay={overlay}
              index={index + childIndex + 1}
              onSelect={onItemSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // ── Bell notification state ──
  const [activeAlertCount, setActiveAlertCount] = useState(0);
  const [alertNoticeCount, setAlertNoticeCount] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const [recentAlerts, setRecentAlerts] = useState<Alert[]>([]);
  const [bellLoading, setBellLoading] = useState(false);
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(() => getStoredAlertsLastSeen());
  const [openSection, setOpenSection] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const bellRef = useRef<HTMLDivElement>(null);
  const closeSidebarTimeoutRef = useRef<number | null>(null);

  const menu: SidebarEntry[] = [
    {
      type: 'item',
      key: 'dashboard',
      label: 'Dashboard',
      path: '/dashboard',
      icon: LayoutDashboard,
      badge: alertNoticeCount > 0 ? { value: alertNoticeCount, tone: 'warning' } : undefined,
    },
    {
      type: 'section',
      key: 'operaciones',
      label: 'Operaciones',
      icon: Activity,
      children: [
        { label: 'Pedidos', path: '/orders' },
        { label: 'Picking', path: '/picking' },
        { label: 'Despacho', path: '/dispatch' },
        { label: 'Devoluciones', path: '/returns' },
      ],
    },
    {
      type: 'section',
      key: 'inventario',
      label: 'Inventario',
      icon: Boxes,
      children: [
        { label: 'Stock', path: '/stock' },
        { label: 'Productos', path: '/products' },
        { label: 'Ubicaciones', path: '/locations' },
        { label: 'Lotes', path: '/batches' },
      ],
    },
    {
      type: 'item',
      key: 'clientes',
      label: 'Clientes',
      path: '/clients',
      icon: Users,
    },
    {
      type: 'section',
      key: 'logistica',
      label: 'Logística',
      icon: Truck,
      children: [
        { label: 'Transportistas', path: '/transporters' },
        { label: 'Tarifas de envío', path: '/shipping-rules', adminOnly: true },
      ],
    },
    {
      type: 'section',
      key: 'integraciones',
      label: 'Integraciones',
      icon: Plug,
      children: [
        { label: 'Mappings ML', path: '/integrations/ml/mappings', adminOnly: true },
      ],
    },
    {
      type: 'section',
      key: 'finanzas',
      label: 'Finanzas',
      icon: Receipt,
      children: [
        { label: 'Facturación', path: '/billing' },
      ],
    },
    {
      type: 'section',
      key: 'configuracion',
      label: 'Configuración',
      icon: Settings,
      children: [
        { label: 'Usuarios', path: '/users', adminOnly: true },
      ],
    },
  ];

  const clientMenu: SidebarEntry[] = [
    {
      type: 'item',
      key: 'dashboard',
      label: 'Dashboard',
      path: '/dashboard',
      icon: LayoutDashboard,
      badge: alertNoticeCount > 0 ? { value: alertNoticeCount, tone: 'warning' } : undefined,
    },
    {
      type: 'item',
      key: 'stock',
      label: 'Stock',
      path: '/stock',
      icon: Boxes,
    },
    {
      type: 'item',
      key: 'pedidos',
      label: 'Pedidos',
      path: '/orders',
      icon: ShoppingBag,
    },
  ];

  const baseMenu = user?.role === 'client' ? clientMenu : menu;

  const visibleMenu = baseMenu
    .map((entry) => {
      if (entry.type === 'item') {
        return entry.adminOnly && user?.role !== 'admin' ? null : entry;
      }

      const children = entry.children.filter((child) => !child.adminOnly || user?.role === 'admin');
      if (children.length === 0) {
        return null;
      }

      return {
        ...entry,
        children,
      } satisfies SidebarGroup;
    })
    .filter((entry): entry is SidebarEntry => entry !== null);

  const sidebarBaseHeight = visibleMenu.length * 48 + Math.max(visibleMenu.length - 1, 0) * 8 + 32;

  const refreshAlerts = useCallback(async () => {
    try {
      const data = await fetchAlerts({ active_only: true });
      setActiveAlertCount(data.length);
      setAlertNoticeCount(hasAlertsToReview(data, lastSeenAt) ? data.length : 0);
      if (bellOpen) {
        setRecentAlerts(data.slice(0, 8));
      }
    } catch { /* silent */ }
  }, [bellOpen, lastSeenAt]);

  // Poll count every 30 seconds
  useEffect(() => {
    const run = () => { refreshAlerts(); };
    run();
    const interval = setInterval(run, 30_000);
    return () => clearInterval(interval);
  }, [refreshAlerts]);

  const markAlertsAsSeen = useCallback(() => {
    const nextSeenAt = new Date().toISOString();
    setStoredAlertsLastSeen(nextSeenAt);
    setLastSeenAt(nextSeenAt);
    setAlertNoticeCount(0);
  }, []);

  useEffect(() => {
    if (location.pathname === '/alerts') {
      markAlertsAsSeen();
    }
  }, [location.pathname, markAlertsAsSeen]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSectionToggle = (sectionKey: string) => {
    setOpenSection((current) => (current === sectionKey ? null : sectionKey));
  };

  const openAlertsPanel = useCallback(async () => {
    setBellOpen(true);
    setBellLoading(true);
    try {
      const data = await fetchAlerts({ active_only: true });
      setRecentAlerts(data.slice(0, 8));
      setActiveAlertCount(data.length);
      markAlertsAsSeen();
    } catch {
      // silent
    } finally {
      setBellLoading(false);
    }
  }, [markAlertsAsSeen]);

  const toggleBell = async () => {
    if (bellOpen) {
      setBellOpen(false);
      return;
    }

    await openAlertsPanel();
  };

  const SEVERITY_DOT: Record<string, string> = {
    critical: 'bg-red-600',
    warning: 'bg-amber-500',
    info: 'bg-blue-600',
  };

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const clearCloseSidebarTimeout = useCallback(() => {
    if (closeSidebarTimeoutRef.current !== null) {
      window.clearTimeout(closeSidebarTimeoutRef.current);
      closeSidebarTimeoutRef.current = null;
    }
  }, []);

  const handleOverlayOpen = useCallback(() => {
    clearCloseSidebarTimeout();
    setOpenSection(null);
    setCollapsed(false);
  }, [clearCloseSidebarTimeout]);

  const scheduleOverlayClose = useCallback(() => {
    clearCloseSidebarTimeout();
    closeSidebarTimeoutRef.current = window.setTimeout(() => {
      setOpenSection(null);
      setCollapsed(true);
      closeSidebarTimeoutRef.current = null;
    }, 120);
  }, [clearCloseSidebarTimeout]);

  useEffect(() => {
    return () => {
      if (closeSidebarTimeoutRef.current !== null) {
        window.clearTimeout(closeSidebarTimeoutRef.current);
      }
    };
  }, []);

  const renderSidebar = () => (
    <aside
      className={[
        'fixed left-0 top-1/2 z-[9999] -translate-y-1/2 overflow-visible transition-[width] duration-300 ease-out max-h-[calc(100vh-112px)]',
        collapsed ? 'w-[72px]' : 'w-[260px]',
      ].join(' ')}
      onMouseEnter={() => handleOverlayOpen()}
      onMouseLeave={scheduleOverlayClose}
    >
      <div
        style={{ minHeight: `${sidebarBaseHeight}px` }}
        className={[
          'ml-4 flex h-auto max-h-[calc(100vh-112px)] flex-col overflow-hidden rounded-2xl border border-white/20 bg-white/85 py-4 shadow-[0_20px_60px_rgba(0,0,0,0.15)] backdrop-blur-xl transition-[width,background-color,box-shadow] duration-300 ease-out',
          collapsed ? 'w-[64px]' : 'w-[244px]',
        ].join(' ')}
      >
        {collapsed ? (
          <nav className="min-h-0 flex flex-1 flex-col items-center gap-2 overflow-y-auto overflow-x-hidden px-2">
            {visibleMenu.map((entry) => {
              const Icon = entry.icon;
              const active = isEntryActive(entry, location.pathname);

              return (
                <button
                  key={`sidebar-${entry.key}`}
                  type="button"
                  title={entry.label}
                  onClick={handleOverlayOpen}
                  onMouseEnter={handleOverlayOpen}
                  className={[
                    'flex h-12 w-12 items-center justify-center rounded-xl transition-all duration-200',
                    active
                      ? 'bg-slate-900 text-white shadow-[0_0_18px_rgba(15,23,42,0.16)]'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-blue-700 hover:shadow-[0_15px_40px_rgba(0,0,0,0.15)]',
                  ].join(' ')}
                  aria-label={entry.label}
                >
                  <Icon size={22} strokeWidth={2.1} />
                </button>
              );
            })}
          </nav>
        ) : (
          <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 animate-[sidebar-overlay-in_260ms_ease-out_both]">
            <div className="space-y-2">
              {visibleMenu.map((entry, index) => {
                if (entry.type === 'item') {
                  return (
                    <SidebarItem
                      key={`${entry.key}-expanded`}
                      label={entry.label}
                      path={entry.path}
                      badge={entry.badge}
                      icon={entry.icon}
                      collapsed={false}
                      overlay
                      index={index}
                      onSelect={() => {
                        setOpenSection(null);
                        setCollapsed(true);
                      }}
                    />
                  );
                }

                return (
                  <SidebarSection
                    key={`${entry.key}-expanded`}
                    entry={entry}
                    currentPath={location.pathname}
                    isOpen={openSection === entry.key}
                    onToggle={handleSectionToggle}
                    collapsed={false}
                    overlay
                    index={index}
                    onItemSelect={() => {
                      setOpenSection(null);
                      setCollapsed(true);
                    }}
                  />
                );
              })}
            </div>
          </nav>
        )}
      </div>
    </aside>
  );

  return (
    <div className="relative flex h-screen flex-col overflow-x-hidden bg-gray-50 text-gray-900 [@keyframes_fade-slide-in]:from{opacity:0;transform:translateX(-10px)} [@keyframes_fade-slide-in]:to{opacity:1;transform:translateX(0)} [@keyframes_sidebar-overlay-in]:from{opacity:0;transform:translateX(-18px);opacity:0} [@keyframes_sidebar-overlay-in]:to{opacity:1;transform:translateX(0)}">
      <header className="fixed left-0 right-0 top-4 z-[10000] px-6">
        <div className="flex h-16 items-center rounded-2xl border border-white/20 bg-white/90 px-6 shadow-[0_8px_25px_rgba(0,0,0,0.06)] backdrop-blur-xl">
          <div className="flex flex-1 items-center">
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="flex items-center rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              aria-label="Ir al dashboard"
            >
              <img
                src="/favicon.png"
                alt="TROD"
                className="h-10 w-10 rounded-lg object-contain"
              />
            </button>
          </div>

          <div className="flex items-center gap-3">

          {/* Bell notification */}
          <div className="relative" ref={bellRef}>
            <button
              onClick={toggleBell}
              className="relative rounded-lg p-2 text-gray-500 hover:bg-blue-50 hover:text-blue-700 transition"
              aria-label="Alertas"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {alertNoticeCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-red-600 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {alertNoticeCount > 99 ? '99+' : alertNoticeCount}
                </span>
              )}
            </button>

            {/* Dropdown */}
            {bellOpen && (
              <div className="absolute right-0 top-full mt-2 w-96 bg-white rounded-xl shadow-lg border border-gray-200 z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                  <h3 className="text-sm font-bold text-gray-900">Alertas</h3>
                </div>

                <div className="max-h-80 overflow-y-auto">
                  {bellLoading ? (
                    <div className="p-6 text-center text-gray-500 text-sm">Cargando...</div>
                  ) : recentAlerts.length === 0 ? (
                    <div className="p-6 text-center text-gray-500 text-sm">Sin alertas activas</div>
                  ) : (
                    recentAlerts.map((alert) => (
                      <div
                        key={alert.id}
                        className="px-4 py-3 border-b border-gray-200/60 flex items-start gap-3 hover:bg-blue-50"
                      >
                        <div className="pt-1.5">
                          <div className={`w-2.5 h-2.5 rounded-full ${SEVERITY_DOT[alert.severity] ?? 'bg-blue-600'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900 leading-tight">{alert.message}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            {new Date(alert.created_at).toLocaleDateString('es-AR', {
                              day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                            })}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="px-4 py-2.5 border-t border-gray-200 bg-gray-50">
                  <button
                    onClick={() => { setBellOpen(false); navigate('/alerts'); }}
                    className="text-sm text-blue-700 hover:text-blue-800 font-medium w-full text-center"
                  >
                    Ver todas las alertas
                  </button>
                </div>
              </div>
            )}
          </div>

          {user?.zones && user.zones.length > 0 && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
              Zona {user.zones.join(', ')}
            </span>
          )}
          <UserMenu
            user={{
              name: user?.full_name ?? 'Usuario',
              role: user?.role ?? 'usuario',
            }}
            onLogout={handleLogout}
          />
          </div>
        </div>
      </header>

      {renderSidebar()}

      <div className="flex min-h-0 flex-1">
        {!collapsed && <div className="fixed inset-0 z-[9998] bg-black/10 backdrop-blur-[2px]" />}

        <main className="ml-[72px] flex flex-1 flex-col overflow-y-auto overflow-x-hidden px-8 pb-8 pt-[104px]">
          <Outlet context={{ activeAlertCount, visibleAlertNoticeCount: alertNoticeCount, openAlertsPanel }} />
        </main>
      </div>
    </div>
  );
}
