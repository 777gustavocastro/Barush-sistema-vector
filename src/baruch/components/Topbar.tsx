import { Bell, ChevronRight, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { NavPageId, NotificationItem } from '../types';

interface TopbarProps {
  pageTitle: string;
  breadcrumb?: string | null;
  globalSearch: string;
  onGlobalSearchChange: (value: string) => void;
  notifications: NotificationItem[];
  onMarkAllRead: () => void;
  onNotificationClick: (page: NavPageId, notificationId: string) => void;
  onOpenSettings: () => void;
  userName: string;
  userRole: string;
  userInitials: string;
}

export function Topbar({
  pageTitle,
  breadcrumb,
  globalSearch,
  onGlobalSearchChange,
  notifications,
  onMarkAllRead,
  onNotificationClick,
  onOpenSettings,
  userName,
  userRole,
  userInitials,
}: TopbarProps) {
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const unreadCount = notifications.filter((n) => n.unread).length;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
    };
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleShortcut);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleShortcut);
    };
  }, []);

  return (
    <header className="sticky top-0 z-20 h-14 bg-[#F6F8FB] px-6 flex items-center justify-between gap-4">
      {/* Título da página + Breadcrumb discreto */}
      <div className="flex items-center gap-2 min-w-0">
        <h1 className="text-[15px] font-semibold text-[#071A34] tracking-[-0.01em] truncate">
          {pageTitle}
        </h1>
        {breadcrumb && (
          <>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="text-[13px] text-[#5A6B82] truncate">{breadcrumb}</span>
          </>
        )}
      </div>

      {/* Busca global + Notificações + Perfil */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="relative hidden sm:block w-56 md:w-64">
          <Search
            className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            strokeWidth={1.75}
          />
          <input
            ref={searchInputRef}
            type="text"
            value={globalSearch}
            onChange={(e) => onGlobalSearchChange(e.target.value)}
            placeholder="Buscar cliente, pedido ou arquivo..."
            className="w-full h-8 pl-8 pr-11 rounded-lg bg-white border border-[#E4EAF1] text-[12.5px] text-[#0F1E36] placeholder:text-slate-400 focus:outline-none focus:border-[#071A34]/35 transition-colors"
          />
          {globalSearch ? (
            <button
              type="button"
              onClick={() => onGlobalSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label="Limpar busca"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 bg-white border border-[#E4EAF1] rounded px-1 py-0.5 leading-none">
              ⌘K
            </kbd>
          )}
        </div>

        {/* Notificações */}
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => setNotifOpen((prev) => !prev)}
            className="relative h-8 w-8 rounded-md flex items-center justify-center text-[#5A6B82] hover:text-[#071A34] hover:bg-[#F1F5F9] transition-colors"
            aria-label="Notificações"
            title="Notificações"
          >
            <Bell className="w-4 h-4" strokeWidth={1.75} />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-[#C89B3C]" />
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 mt-1.5 w-80 bg-white rounded-lg border border-[#E4EAF1] shadow-lg shadow-[#071A34]/8 overflow-hidden z-40">
              <div className="px-3.5 py-2.5 border-b border-[#EEF2F7] flex items-center justify-between">
                <span className="text-[12.5px] font-semibold text-[#071A34]">
                  Notificações
                </span>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={onMarkAllRead}
                    className="text-[11.5px] text-[#8E6A1F] hover:text-[#071A34] font-medium"
                  >
                    Marcar lidas
                  </button>
                )}
              </div>
              <div className="divide-y divide-[#F1F5F9] max-h-72 overflow-y-auto">
                {notifications.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onNotificationClick(item.targetPage, item.id);
                      setNotifOpen(false);
                    }}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-[#F8FAFC] transition-colors flex items-start gap-2.5"
                  >
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${
                        item.unread ? 'bg-[#C89B3C]' : 'bg-slate-300'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12.5px] font-medium text-[#0F1E36] truncate">
                          {item.title}
                        </span>
                        <span className="text-[11px] text-slate-400 shrink-0">{item.time}</span>
                      </div>
                      <p className="text-[12px] text-[#5A6B82] mt-0.5 leading-snug">
                        {item.detail}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Perfil do usuário */}
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-md hover:bg-[#F1F5F9] transition-colors text-left"
          title="Abrir perfil e configurações"
        >
          <div className="w-7 h-7 rounded-full bg-[#071A34] text-[#E3C16F] text-[11px] font-semibold flex items-center justify-center shrink-0">
            {userInitials}
          </div>
          <div className="hidden md:block leading-tight">
            <div className="text-[12.5px] font-medium text-[#0F1E36]">{userName}</div>
            <div className="text-[11px] text-[#5A6B82]">{userRole}</div>
          </div>
        </button>
      </div>
    </header>
  );
}
