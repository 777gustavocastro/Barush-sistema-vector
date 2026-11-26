import { LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { MAIN_NAV_ITEMS, SETTINGS_NAV_ITEM } from '../navigation';
import type { NavPageId } from '../types';
import { BaruchLogo } from './BaruchLogo';

interface SidebarProps {
  activePage: NavPageId;
  collapsed: boolean;
  onSelectPage: (page: NavPageId) => void;
  onToggleCollapse: () => void;
  onLogout: () => void;
  userName: string;
  userRole: string;
  userInitials: string;
}

export function Sidebar({
  activePage,
  collapsed,
  onSelectPage,
  onToggleCollapse,
  onLogout,
  userName,
  userRole,
  userInitials,
}: SidebarProps) {
  const SettingsIcon = SETTINGS_NAV_ITEM.icon;
  const isSettingsActive = activePage === 'settings';

  return (
    <aside
      aria-label="Navegação principal"
      className={`fixed inset-y-0 left-0 z-30 flex flex-col bg-[#071A34] text-slate-200 border-r border-white/[0.07] transition-[width] duration-200 ease-out select-none ${
        collapsed ? 'w-[70px]' : 'w-[252px]'
      }`}
    >
      {/* Topo: Logo + Nome BARUCH + Recolher/Expandir */}
      <div
        className={`flex items-center h-14 shrink-0 border-b border-white/[0.07] ${
          collapsed ? 'justify-center px-2' : 'justify-between px-4'
        }`}
      >
        <button
          type="button"
          onClick={() => (collapsed ? onToggleCollapse() : onSelectPage('dashboard'))}
          className="relative flex items-center gap-2.5 min-w-0 text-left focus:outline-none group/brand"
          title={collapsed ? 'Expandir menu' : 'BARUCH — Ir para Dashboard'}
          aria-label={collapsed ? 'Expandir menu lateral' : 'Ir para Dashboard'}
        >
          <span className="relative shrink-0 w-[30px] h-[30px]">
            <BaruchLogo
              size={30}
              className={`absolute inset-0 transition-opacity duration-150 ${
                collapsed ? 'group-hover/brand:opacity-0' : ''
              }`}
            />
            {collapsed && (
              <span className="absolute inset-0 flex items-center justify-center rounded-lg text-[#E3C16F] opacity-0 group-hover/brand:opacity-100 transition-opacity duration-150">
                <PanelLeftOpen className="w-4 h-4" strokeWidth={1.75} />
              </span>
            )}
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[14px] font-semibold tracking-[0.14em] text-white leading-none">
                  BARUCH
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-[#D4A643] shrink-0" />
              </div>
              <span className="block text-[10px] tracking-[0.06em] text-slate-400 mt-0.5 truncate">
                Gestão Gráfica
              </span>
            </div>
          )}
        </button>

        {!collapsed && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/[0.07] transition-colors"
            title="Recolher menu"
            aria-label="Recolher menu lateral"
          >
            <PanelLeftClose className="w-4 h-4" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {/* Navegação principal */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden sidebar-scroll px-2.5 py-3 space-y-0.5">
        {MAIN_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.id;

          return (
            <div key={item.id} className="relative group">
              <button
                type="button"
                onClick={() => onSelectPage(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative w-full flex items-center rounded-md text-[13px] transition-colors duration-150 ${
                  collapsed ? 'justify-center h-9 px-0' : 'gap-2.5 h-9 px-3'
                } ${
                  isActive
                    ? 'bg-[#102B50] text-white font-medium'
                    : 'text-slate-300/90 hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                {isActive && (
                  <span
                    className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r bg-[#D4A643]"
                    aria-hidden="true"
                  />
                )}
                <Icon
                  className={`w-[17px] h-[17px] shrink-0 transition-colors ${
                    isActive
                      ? 'text-[#E3C16F]'
                      : 'text-slate-400 group-hover:text-slate-200'
                  }`}
                  strokeWidth={1.75}
                />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>

              {/* Tooltip quando recolhido */}
              {collapsed && (
                <div
                  role="tooltip"
                  className="pointer-events-none fixed left-[76px] -translate-y-8 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                >
                  <div className="bg-[#0B2242] text-white text-[12px] font-medium px-2.5 py-1.5 rounded-md shadow-lg border border-white/10 whitespace-nowrap">
                    {item.label}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Rodapé da Sidebar: Configurações, Perfil do usuário e Sair */}
      <div className="shrink-0 border-t border-white/[0.07] px-2.5 py-2.5 space-y-1.5">
        <div className="relative group">
          <button
            type="button"
            onClick={() => onSelectPage('settings')}
            aria-current={isSettingsActive ? 'page' : undefined}
            className={`relative w-full flex items-center rounded-md text-[13px] transition-colors ${
              collapsed ? 'justify-center h-9 px-0' : 'gap-2.5 h-9 px-3'
            } ${
              isSettingsActive
                ? 'bg-[#102B50] text-white font-medium'
                : 'text-slate-300/90 hover:text-white hover:bg-white/[0.05]'
            }`}
          >
            {isSettingsActive && (
              <span
                className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r bg-[#D4A643]"
                aria-hidden="true"
              />
            )}
            <SettingsIcon
              className={`w-[17px] h-[17px] shrink-0 ${
                isSettingsActive ? 'text-[#E3C16F]' : 'text-slate-400 group-hover:text-slate-200'
              }`}
              strokeWidth={1.75}
            />
            {!collapsed && <span className="truncate">{SETTINGS_NAV_ITEM.label}</span>}
          </button>

          {collapsed && (
            <div
              role="tooltip"
              className="pointer-events-none fixed left-[76px] -translate-y-8 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            >
              <div className="bg-[#0B2242] text-white text-[12px] font-medium px-2.5 py-1.5 rounded-md shadow-lg border border-white/10 whitespace-nowrap">
                Configurações
              </div>
            </div>
          )}
        </div>

        {/* Usuário logado + Sair */}
        <div
          className={`flex items-center rounded-md bg-white/[0.03] ${
            collapsed ? 'flex-col gap-1.5 py-2 px-1' : 'justify-between px-2.5 py-2'
          }`}
        >
          <button
            type="button"
            onClick={() => onSelectPage('settings')}
            className="flex items-center gap-2.5 min-w-0 text-left focus:outline-none group"
            title={`${userName} — ${userRole}`}
          >
            <div className="w-7 h-7 rounded-full bg-[#13315C] border border-[#D4A643]/40 text-[#E3C16F] text-[11px] font-semibold flex items-center justify-center shrink-0">
              {userInitials}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium text-white truncate leading-tight">
                  {userName}
                </div>
                <div className="text-[11px] text-slate-400 truncate leading-tight mt-0.5">
                  {userRole}
                </div>
              </div>
            )}
          </button>

          <button
            type="button"
            onClick={onLogout}
            className="p-1.5 rounded-md text-slate-400 hover:text-rose-300 hover:bg-white/[0.06] transition-colors shrink-0"
            title="Sair do sistema"
            aria-label="Sair do sistema"
          >
            <LogOut className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </aside>
  );
}
