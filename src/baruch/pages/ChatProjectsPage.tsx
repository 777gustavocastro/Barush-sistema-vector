import { FileCode2, Paperclip, Plus, Send, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PROJECT_THREADS } from '../data/mockData';
import type { ProjectThread } from '../types';

interface ChatProjectsPageProps {
  globalSearch: string;
  onBreadcrumbChange: (crumb: string | null) => void;
}

const THREAD_STATUS: Record<ProjectThread['status'], { label: string; style: string }> = {
  em_criacao: {
    label: 'Em criação',
    style: 'bg-[#071A34]/8 text-[#071A34]',
  },
  aguardando_cliente: {
    label: 'Aguardando cliente',
    style: 'bg-[#C89B3C]/15 text-[#8A6418]',
  },
  aprovado: {
    label: 'Aprovado',
    style: 'bg-emerald-50 text-emerald-700',
  },
};

export function ChatProjectsPage({
  globalSearch,
  onBreadcrumbChange,
}: ChatProjectsPageProps) {
  const [threads, setThreads] = useState<ProjectThread[]>(PROJECT_THREADS);
  const [selectedId, setSelectedId] = useState<string>(PROJECT_THREADS[0].id);
  const [draft, setDraft] = useState('');

  const filteredThreads = threads.filter((t) => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      t.title.toLowerCase().includes(q) ||
      t.clientName.toLowerCase().includes(q) ||
      t.productRef.toLowerCase().includes(q)
    );
  });

  const activeThread =
    threads.find((t) => t.id === selectedId) ?? filteredThreads[0] ?? threads[0];

  useEffect(() => {
    onBreadcrumbChange(activeThread ? activeThread.clientName : null);
    return () => onBreadcrumbChange(null);
  }, [activeThread, onBreadcrumbChange]);

  const handleSend = () => {
    const text = draft.trim();
    if (!text || !activeThread) return;

    const now = new Date().toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });

    setThreads((prev) =>
      prev.map((thread) =>
        thread.id !== activeThread.id
          ? thread
          : {
              ...thread,
              updatedAt: now,
              messages: [
                ...thread.messages,
                {
                  id: `u-${Date.now()}`,
                  sender: 'user',
                  text,
                  time: now,
                },
                {
                  id: `a-${Date.now() + 1}`,
                  sender: 'ai',
                  text: `Instrução aplicada ao projeto "${thread.title}". Especificações de impressão (${thread.productRef}) e área de segurança conferidas.`,
                  time: now,
                },
              ],
            }
      )
    );
    setDraft('');
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-8.5rem)]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[13.5px] font-semibold text-[#071A34]">
            Projetos por cliente
          </h2>
          <p className="text-[11.5px] text-[#5A6B82]">
            {filteredThreads.length} projeto(s) ativo(s)
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            const id = `prj-${Date.now()}`;
            const created: ProjectThread = {
              id,
              clientId: 'cli-1',
              clientName: 'Construtora Horizonte',
              title: 'Nova Arte Personalizada',
              productRef: 'Especificação sob demanda',
              status: 'em_criacao',
              updatedAt: 'Agora',
              messages: [
                {
                  id: `ai-${Date.now()}`,
                  sender: 'ai',
                  text: 'Projeto iniciado. Informe o formato, substrato ou envie uma referência para gerar a arte e fechar o arquivo de impressão.',
                  time: 'Agora',
                },
              ],
            };
            setThreads((prev) => [created, ...prev]);
            setSelectedId(id);
          }}
          className="h-7 px-2.5 rounded-md bg-[#071A34] text-white text-[12px] font-medium hover:bg-[#0D284D] transition-colors inline-flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5 text-[#E3C16F]" />
          Novo
        </button>
      </div>

    <div className="bg-white border border-[#E4EAF1] rounded-lg overflow-hidden grid grid-cols-1 lg:grid-cols-12 flex-1 min-h-0">
      {/* Lista de projetos por cliente */}
      <aside className="lg:col-span-4 xl:col-span-3 border-b lg:border-b-0 lg:border-r border-[#EEF2F7] flex flex-col">
        <div className="divide-y divide-[#F1F5F9] overflow-y-auto flex-1">
          {filteredThreads.map((thread) => {
            const isSelected = thread.id === activeThread?.id;
            const badge = THREAD_STATUS[thread.status];
            return (
              <button
                key={thread.id}
                type="button"
                onClick={() => setSelectedId(thread.id)}
                className={`w-full text-left px-4 py-3 transition-colors border-l-2 ${
                  isSelected
                    ? 'bg-[#F5F8FC] border-l-[#C89B3C]'
                    : 'border-l-transparent hover:bg-[#FAFBFD]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11.5px] font-medium text-[#5A6B82] truncate">
                    {thread.clientName}
                  </span>
                  <span className="text-[11px] text-slate-400 shrink-0">
                    {thread.updatedAt}
                  </span>
                </div>
                <div className="text-[13px] font-medium text-[#071A34] mt-0.5 truncate">
                  {thread.title}
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="text-[11.5px] text-slate-500 truncate">
                    {thread.productRef}
                  </span>
                  <span
                    className={`text-[10.5px] font-medium px-2 py-0.5 rounded-full shrink-0 ${badge.style}`}
                  >
                    {badge.label}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Área de conversa com IA e edição de artes */}
      <section className="lg:col-span-8 xl:col-span-9 flex flex-col bg-[#FAFBFD]">
        {activeThread && (
          <>
            <div className="px-5 pt-4 pb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-[#071A34] truncate">
                  {activeThread.title}
                </div>
                <div className="text-[12px] text-[#5A6B82]">
                  {activeThread.clientName} · {activeThread.productRef}
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[#071A34] bg-[#F1F5F9] px-2.5 py-1 rounded-md">
                <Sparkles className="w-3.5 h-3.5 text-[#C89B3C]" />
                Assistente de Arte BARUCH
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {activeThread.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[78%] rounded-lg px-4 py-3 text-[13px] leading-relaxed ${
                      msg.sender === 'user'
                        ? 'bg-[#071A34] text-white'
                        : 'bg-white border border-[#E4EAF1] text-[#0F1E36]'
                    }`}
                  >
                    <p>{msg.text}</p>
                    {msg.attachment && (
                      <div className="mt-2.5 pt-2.5 border-t border-[#EEF2F7] flex items-center gap-2 text-[12px] text-[#071A34] font-medium">
                        <FileCode2 className="w-4 h-4 text-[#C89B3C] shrink-0" />
                        <span className="font-mono truncate">{msg.attachment}</span>
                      </div>
                    )}
                    <div
                      className={`text-[10.5px] mt-1.5 ${
                        msg.sender === 'user' ? 'text-slate-300 text-right' : 'text-slate-400'
                      }`}
                    >
                      {msg.time}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-3.5 bg-white border-t border-[#EEF2F7]">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex items-center gap-2"
              >
                <button
                  type="button"
                  className="h-9 w-9 rounded-md border border-[#E4EAF1] text-[#5A6B82] hover:text-[#071A34] hover:bg-[#F6F8FB] flex items-center justify-center shrink-0 transition-colors"
                  title="Anexar arte ou referência"
                >
                  <Paperclip className="w-4 h-4" strokeWidth={1.75} />
                </button>
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Descreva o ajuste de arte, acabamento, sangria ou peça para a IA..."
                  className="flex-1 h-9 px-3 rounded-md bg-[#F6F8FB] border border-[#E4EAF1] text-[13px] text-[#0F1E36] placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-[#071A34]/35"
                />
                <button
                  type="submit"
                  className="h-9 px-3.5 rounded-md bg-[#071A34] text-white text-[12.5px] font-medium hover:bg-[#0D284D] transition-colors inline-flex items-center gap-1.5 shrink-0"
                >
                  <Send className="w-3.5 h-3.5 text-[#E3C16F]" />
                  Enviar
                </button>
              </form>
            </div>
          </>
        )}
      </section>
    </div>
    </div>
  );
}
