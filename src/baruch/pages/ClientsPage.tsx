import { FolderOpen, Mail, MapPin, MessageSquareText, Phone, Plus, ShoppingBag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CLIENTS, FILE_ASSETS, INITIAL_SALES, formatBRL } from '../data/mockData';
import type { NavPageId } from '../types';

interface ClientsPageProps {
  globalSearch: string;
  onBreadcrumbChange: (crumb: string | null) => void;
  onNavigate: (page: NavPageId) => void;
}

export function ClientsPage({
  globalSearch,
  onBreadcrumbChange,
  onNavigate,
}: ClientsPageProps) {
  const [selectedId, setSelectedId] = useState<string>(CLIENTS[0].id);

  const filtered = CLIENTS.filter((c) => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      c.company.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q)
    );
  });

  const selected =
    CLIENTS.find((c) => c.id === selectedId) ?? filtered[0] ?? CLIENTS[0];

  useEffect(() => {
    onBreadcrumbChange(selected ? selected.company : null);
    return () => onBreadcrumbChange(null);
  }, [selected, onBreadcrumbChange]);

  const clientFiles = FILE_ASSETS.filter((f) => f.clientId === selected?.id);
  const clientSales = INITIAL_SALES.filter((s) => s.clientId === selected?.id);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-[#071A34] tracking-[-0.015em]">
            Base de clientes
          </h2>
          <p className="text-[12.5px] text-[#5A6B82] mt-0.5">
            Cadastro comercial, identidade visual e histórico consolidado de artes e pedidos.
          </p>
        </div>

        <button
          type="button"
          className="h-8 px-3.5 rounded-md bg-[#071A34] text-white text-[12.5px] font-medium hover:bg-[#0D284D] transition-colors inline-flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5 text-[#E3C16F]" />
          Novo cliente
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Lista de clientes */}
        <div className="lg:col-span-7 bg-white border border-[#E4EAF1] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#EEF2F7] bg-[#FAFBFD] text-[11.5px] font-medium text-[#5A6B82]">
                  <th className="py-2.5 px-4">Cliente</th>
                  <th className="py-2.5 px-4">Pedidos</th>
                  <th className="py-2.5 px-4 text-right">Volume total</th>
                  <th className="py-2.5 px-4 text-right">Última atividade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9] text-[13px]">
                {filtered.map((client) => {
                  const isActive = client.id === selected?.id;
                  return (
                    <tr
                      key={client.id}
                      onClick={() => setSelectedId(client.id)}
                      className={`cursor-pointer transition-colors ${
                        isActive ? 'bg-[#F3F7FC]' : 'hover:bg-[#F8FAFC]'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-8 h-8 rounded-md text-white text-[11px] font-semibold flex items-center justify-center shrink-0"
                            style={{ backgroundColor: client.accentColor }}
                          >
                            {client.initials}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-[#071A34] truncate">
                              {client.company}
                            </div>
                            <div className="text-[12px] text-[#5A6B82] truncate">
                              {client.name}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 tabular-nums text-[#334155]">
                        {client.ordersCount}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums font-medium text-[#071A34]">
                        {formatBRL(client.totalSpent)}
                      </td>
                      <td className="py-3 px-4 text-right text-[12px] text-[#5A6B82] whitespace-nowrap">
                        {client.lastActivity}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Painel de ficha do cliente selecionado */}
        {selected && (
          <aside className="lg:col-span-5 bg-white border border-[#E4EAF1] rounded-lg p-5 space-y-5 self-start">
            <div className="flex items-start gap-3.5">
              <div
                className="w-11 h-11 rounded-lg text-white text-[14px] font-semibold flex items-center justify-center shrink-0"
                style={{ backgroundColor: selected.accentColor }}
              >
                {selected.initials}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-semibold text-[#071A34] truncate">
                  {selected.company}
                </h3>
                <p className="text-[12.5px] text-[#5A6B82]">
                  {selected.name} · CNPJ {selected.document}
                </p>
              </div>
            </div>

            <div className="space-y-1.5 text-[12.5px] text-[#334155] pt-1 border-t border-[#EEF2F7]">
              <div className="flex items-center gap-2 pt-2">
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                <span>{selected.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                <span>{selected.phone}</span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                <span>{selected.city}</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#EEF2F7]">
              <div>
                <div className="text-[11px] text-[#5A6B82]">Total comprado</div>
                <div className="text-[13.5px] font-semibold text-[#071A34] tabular-nums mt-0.5">
                  {formatBRL(selected.totalSpent)}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#5A6B82]">Pedidos</div>
                <div className="text-[13.5px] font-semibold text-[#071A34] tabular-nums mt-0.5">
                  {selected.ordersCount}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-[#5A6B82]">Projetos</div>
                <div className="text-[13.5px] font-semibold text-[#9A7220] tabular-nums mt-0.5">
                  {selected.activeProjects} ativos
                </div>
              </div>
            </div>

            {/* Arquivos e histórico */}
            <div className="space-y-2 pt-2 border-t border-[#EEF2F7]">
              <div className="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-[#5A6B82]">
                Arquivos e artes ({clientFiles.length})
              </div>
              {clientFiles.length > 0 ? (
                <div className="space-y-1.5">
                  {clientFiles.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between text-[12.5px] py-1.5 px-2.5 rounded bg-[#F6F8FB]"
                    >
                      <span className="font-mono text-[12px] text-[#0F1E36] truncate">
                        {file.name}
                      </span>
                      <span className="text-[11px] text-[#5A6B82] shrink-0 ml-2">
                        {file.size}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-slate-400">Nenhum arquivo recente.</p>
              )}
            </div>

            {clientSales.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-[#EEF2F7]">
                <div className="text-[11.5px] font-semibold uppercase tracking-[0.05em] text-[#5A6B82]">
                  Última compra
                </div>
                <div className="text-[12.5px] text-[#0F1E36] flex items-center justify-between">
                  <span className="truncate">{clientSales[0].itemsSummary}</span>
                  <span className="font-semibold text-[#071A34] tabular-nums ml-2 shrink-0">
                    {formatBRL(clientSales[0].total)}
                  </span>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => onNavigate('chat_projects')}
                className="flex-1 h-8 rounded-md bg-[#071A34] text-white text-[12px] font-medium hover:bg-[#0D284D] transition-colors inline-flex items-center justify-center gap-1.5"
              >
                <MessageSquareText className="w-3.5 h-3.5 text-[#E3C16F]" />
                Projetos
              </button>
              <button
                type="button"
                onClick={() => onNavigate('files')}
                className="flex-1 h-8 rounded-md border border-[#DCE3EC] bg-white text-[#0F1E36] text-[12px] font-medium hover:bg-[#F8FAFC] transition-colors inline-flex items-center justify-center gap-1.5"
              >
                <FolderOpen className="w-3.5 h-3.5 text-[#5A6B82]" />
                Arquivos
              </button>
              <button
                type="button"
                onClick={() => onNavigate('sales')}
                className="flex-1 h-8 rounded-md border border-[#DCE3EC] bg-white text-[#0F1E36] text-[12px] font-medium hover:bg-[#F8FAFC] transition-colors inline-flex items-center justify-center gap-1.5"
              >
                <ShoppingBag className="w-3.5 h-3.5 text-[#5A6B82]" />
                Vender
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
