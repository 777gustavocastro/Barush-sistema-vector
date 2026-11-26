import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { ClientRecord } from '../types';

interface CompanyDrawerProps {
  clients: ClientRecord[];
  activeClientId: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectClient: (clientId: string) => void;
}

/**
 * Gaveta lateral esquerda dentro da página de Chat:
 * representa empresas/conversas independentes sobre fundo infinito com divisória discreta.
 */
export function CompanyDrawer({
  clients,
  activeClientId,
  collapsed,
  onToggleCollapse,
  onSelectClient,
}: CompanyDrawerProps) {
  return (
    <aside
      aria-label="Empresas e conversas"
      className={`shrink-0 flex flex-col border-r border-[#E4EAF1]/90 pr-2.5 transition-[width] duration-200 ease-out select-none ${
        collapsed ? 'w-[54px]' : 'w-[218px]'
      }`}
    >
      {/* Topo da gaveta com controle de recolher/expandir */}
      <div
        className={`flex items-center h-9 mb-2 ${
          collapsed ? 'justify-center' : 'justify-between px-1'
        }`}
      >
        {!collapsed && (
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#5A6B82]">
            Empresas
          </span>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-1.5 rounded-md text-[#5A6B82] hover:text-[#071A34] hover:bg-white/80 transition-colors"
          title={collapsed ? 'Expandir lista de empresas' : 'Recolher lista de empresas'}
          aria-label={collapsed ? 'Expandir lista de empresas' : 'Recolher lista de empresas'}
        >
          {collapsed ? (
            <PanelLeftOpen className="w-4 h-4" strokeWidth={1.75} />
          ) : (
            <PanelLeftClose className="w-4 h-4" strokeWidth={1.75} />
          )}
        </button>
      </div>

      {/* Lista de empresas/conversas */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pb-4">
        {clients.map((client) => {
          const isActive = client.id === activeClientId;
          return (
            <button
              key={client.id}
              type="button"
              onClick={() => onSelectClient(client.id)}
              title={collapsed ? `${client.company} — ${client.name}` : undefined}
              className={`w-full flex items-center rounded-xl transition-all text-left border ${
                collapsed
                  ? 'justify-center p-1.5'
                  : 'gap-2.5 px-2.5 py-2'
              } ${
                isActive
                  ? 'bg-white border-[#D6DFEA] shadow-[0_1px_2px_rgba(7,26,52,0.04)]'
                  : 'bg-transparent border-transparent hover:bg-white/65 hover:border-[#E4EAF1]/80'
              }`}
            >
              <div
                className={`w-8 h-8 rounded-lg text-white text-[11px] font-semibold flex items-center justify-center shrink-0 transition-transform ${
                  isActive ? 'ring-2 ring-[#C89B3C]/60 ring-offset-1 ring-offset-white' : ''
                }`}
                style={{ backgroundColor: client.accentColor }}
              >
                {client.initials}
              </div>

              {!collapsed && (
                <div className="min-w-0 flex-1 leading-tight">
                  <div
                    className={`text-[12.5px] truncate ${
                      isActive ? 'font-semibold text-[#071A34]' : 'font-medium text-[#1E2F47]'
                    }`}
                  >
                    {client.company}
                  </div>
                  <div className="text-[11px] text-[#5A6B82] truncate mt-0.5">
                    {client.name}
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
