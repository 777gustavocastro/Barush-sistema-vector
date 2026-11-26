import {
  CheckCircle2,
  FileCode2,
  FileImage,
  FileText,
  FolderOpen,
  History,
  Image as ImageIcon,
  Mail,
  MapPin,
  MessageSquareText,
  Phone,
  Plus,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { CLIENTS, FILE_ASSETS, INITIAL_SALES, formatBRL } from '../data/mockData';
import type { ClientRecord } from '../types';
import type { ChatConversation, ChatMediaItem } from './chatTypes';

interface ClientDrawerProps {
  open: boolean;
  onClose: () => void;
  client: ClientRecord;
  onChangeClient: (clientId: string) => void;
  conversations: ChatConversation[];
  activeConversationId: string;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  mediaItems: ChatMediaItem[];
  onSelectMediaAsRef: (media: ChatMediaItem) => void;
}

type DrawerTab = 'projetos' | 'arquivos' | 'galeria' | 'historico';

export function ClientDrawer({
  open,
  onClose,
  client,
  onChangeClient,
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  mediaItems,
  onSelectMediaAsRef,
}: ClientDrawerProps) {
  const [tab, setTab] = useState<DrawerTab>('projetos');
  const [onlyApproved, setOnlyApproved] = useState(false);

  if (!open) return null;

  const clientConversations = conversations.filter((c) => c.clientId === client.id);
  const clientFiles = FILE_ASSETS.filter((f) => f.clientId === client.id);
  const clientSales = INITIAL_SALES.filter((s) => s.clientId === client.id);
  const displayedMedia = onlyApproved
    ? mediaItems.filter((m) => m.approved)
    : mediaItems;

  return (
    <aside
      aria-label="Informações do cliente e arquivos"
      className="w-[310px] shrink-0 bg-white border border-[#E4EAF1] rounded-xl flex flex-col overflow-hidden h-[calc(100vh-5.5rem)] sticky top-16"
    >
      {/* Topo da gaveta: cliente + seletor + fechar */}
      <div className="px-4 py-3.5 border-b border-[#EEF2F7] space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-9 h-9 rounded-lg text-white text-[12px] font-semibold flex items-center justify-center shrink-0"
              style={{ backgroundColor: client.accentColor }}
            >
              {client.initials}
            </div>
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-[#071A34] truncate">
                {client.company}
              </div>
              <div className="text-[11.5px] text-[#5A6B82] truncate">{client.name}</div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-[#071A34] hover:bg-[#F6F8FB] transition-colors"
            title="Fechar painel do cliente"
            aria-label="Fechar painel do cliente"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <select
          value={client.id}
          onChange={(e) => onChangeClient(e.target.value)}
          aria-label="Trocar cliente da conversa"
          className="w-full h-8 px-2.5 rounded-lg bg-[#F6F8FB] border border-[#E4EAF1] text-[12px] text-[#0F1E36] focus:outline-none focus:bg-white focus:border-[#071A34]/35"
        >
          {CLIENTS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.company} — {c.name}
            </option>
          ))}
        </select>

        <div className="space-y-1 text-[11.5px] text-[#5A6B82]">
          <div className="flex items-center gap-1.5 truncate">
            <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">{client.email}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>{client.phone}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>{client.city}</span>
          </div>
        </div>
      </div>

      {/* Abas compactas */}
      <div className="grid grid-cols-4 border-b border-[#EEF2F7] px-2 pt-1.5 bg-[#FAFBFD]">
        {(
          [
            { id: 'projetos', label: 'Projetos', icon: MessageSquareText },
            { id: 'arquivos', label: 'Arquivos', icon: FolderOpen },
            { id: 'galeria', label: 'Artes', icon: ImageIcon },
            { id: 'historico', label: 'Histórico', icon: History },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`pb-2 pt-1 text-[11px] font-medium flex flex-col items-center gap-1 border-b-2 transition-colors ${
                active
                  ? 'border-[#C89B3C] text-[#071A34]'
                  : 'border-transparent text-[#5A6B82] hover:text-[#071A34]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" strokeWidth={1.75} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Conteúdo da aba */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
        {tab === 'projetos' && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] font-medium text-[#5A6B82]">
                Conversas ({clientConversations.length})
              </span>
              <button
                type="button"
                onClick={onNewConversation}
                className="h-7 px-2.5 rounded-md bg-[#071A34] text-white text-[11.5px] font-medium hover:bg-[#0D284D] inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3 text-[#E3C16F]" />
                Nova
              </button>
            </div>
            <div className="space-y-1.5">
              {clientConversations.map((conv) => {
                const isCurrent = conv.id === activeConversationId;
                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => onSelectConversation(conv.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                      isCurrent
                        ? 'bg-[#F3F7FC] border-[#071A34]/20 text-[#071A34]'
                        : 'bg-white border-[#EEF2F7] hover:bg-[#FAFBFD] text-[#334155]'
                    }`}
                  >
                    <div className="text-[12.5px] font-medium truncate">{conv.title}</div>
                    <div className="text-[11px] text-[#5A6B82] mt-0.5">
                      {conv.messages.length} mensagens · {conv.updatedAt}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {tab === 'arquivos' && (
          <div className="space-y-2">
            <span className="text-[11.5px] font-medium text-[#5A6B82]">
              Biblioteca do cliente ({clientFiles.length})
            </span>
            {clientFiles.length === 0 ? (
              <p className="text-[12px] text-slate-400">Nenhum arquivo cadastrado.</p>
            ) : (
              clientFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#FAFBFD] border border-[#EEF2F7]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {file.format === 'SVG' ? (
                      <FileCode2 className="w-3.5 h-3.5 text-[#C89B3C] shrink-0" />
                    ) : file.format === 'PDF' ? (
                      <FileText className="w-3.5 h-3.5 text-[#071A34] shrink-0" />
                    ) : (
                      <FileImage className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-mono text-[11.5px] text-[#0F1E36] truncate">
                        {file.name}
                      </div>
                      <div className="text-[10.5px] text-[#5A6B82]">
                        {file.size} · {file.updatedAt}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'galeria' && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] font-medium text-[#5A6B82]">
                Imagens ({displayedMedia.length})
              </span>
              <button
                type="button"
                onClick={() => setOnlyApproved((v) => !v)}
                className={`text-[11px] px-2 py-0.5 rounded-md font-medium transition-colors ${
                  onlyApproved
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-[#F6F8FB] text-[#5A6B82] hover:text-[#071A34]'
                }`}
              >
                Aprovadas
              </button>
            </div>
            {displayedMedia.length === 0 ? (
              <p className="text-[12px] text-slate-400">
                {onlyApproved
                  ? 'Nenhuma arte aprovada nesta conversa.'
                  : 'Anexe ou gere uma imagem no chat para vê-la aqui.'}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {displayedMedia.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectMediaAsRef(item)}
                    className="group relative rounded-lg border border-[#E4EAF1] bg-[#FAFBFD] overflow-hidden text-left hover:border-[#071A34]/35 transition-colors"
                    title="Usar esta imagem como referência"
                  >
                    <img
                      src={item.imageUrl}
                      alt={item.label}
                      className="w-full h-20 object-cover"
                    />
                    {item.approved && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 bg-white rounded-full absolute top-1.5 right-1.5" />
                    )}
                    <div className="px-2 py-1 text-[10.5px] text-[#0F1E36] truncate">
                      {item.label}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'historico' && (
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 rounded-lg bg-[#FAFBFD] border border-[#EEF2F7]">
                <div className="text-[10.5px] text-[#5A6B82]">Pedidos</div>
                <div className="text-[14px] font-semibold text-[#071A34] tabular-nums">
                  {client.ordersCount}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#FAFBFD] border border-[#EEF2F7]">
                <div className="text-[10.5px] text-[#5A6B82]">Volume</div>
                <div className="text-[14px] font-semibold text-[#071A34] tabular-nums">
                  {formatBRL(client.totalSpent)}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-[11.5px] font-medium text-[#5A6B82]">
                Compras recentes
              </span>
              {clientSales.length === 0 ? (
                <p className="text-[12px] text-slate-400">Sem compras recentes.</p>
              ) : (
                clientSales.map((sale) => (
                  <div
                    key={sale.id}
                    className="px-2.5 py-2 rounded-lg bg-[#FAFBFD] border border-[#EEF2F7] text-[12px]"
                  >
                    <div className="flex items-center justify-between font-medium text-[#071A34]">
                      <span className="font-mono text-[11px]">{sale.code}</span>
                      <span className="tabular-nums">{formatBRL(sale.total)}</span>
                    </div>
                    <div className="text-[11px] text-[#5A6B82] truncate mt-0.5">
                      {sale.itemsSummary}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
