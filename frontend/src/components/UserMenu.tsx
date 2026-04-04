import { useEffect, useRef, useState } from 'react';
import { LogOut } from 'lucide-react';

type UserMenuProps = {
  user: {
    name: string;
    role: string;
  };
  onLogout: () => void;
};

function formatRole(role: string): string {
  const normalizedRole = role.toLowerCase();
  if (normalizedRole === 'admin') return 'Admin';
  if (normalizedRole === 'operator') return 'Operario';
  if (normalizedRole === 'operario') return 'Operario';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export default function UserMenu({ user, onLogout }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const userName = user.name?.trim() || 'Usuario';
  const userRole = formatRole(user.role || 'usuario');
  const initial = userName.charAt(0).toUpperCase();

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Abrir menú de usuario"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white transition-all duration-150 ease-out hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        {initial}
      </button>

      <div
        className={[
          'absolute right-0 top-full z-50 mt-2 w-64 origin-top-right rounded-lg border border-gray-200 bg-white shadow-md transition-all duration-150 ease-out',
          isOpen
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none -translate-y-1 opacity-0',
        ].join(' ')}
        role="menu"
      >
        <div className="p-3">
          <p className="text-sm font-medium text-gray-900">{userName}</p>
          <p className="mt-0.5 text-xs text-gray-500">{userRole}</p>
        </div>

        <div className="border-t border-gray-200" />

        <div className="p-2">
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-red-600 transition-all duration-150 ease-out hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            role="menuitem"
          >
            <LogOut size={16} />
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}