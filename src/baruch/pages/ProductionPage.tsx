import { AlertCircle, CheckCircle2, Clock, LayoutGrid, List, MoreHorizontal, Package, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SelectMenu } from '../components/SelectMenu';
import { loadActivities, loadClients } from '../clients/clientStore';
import type { ClientActivity, ClientProfile } from '../clients/clientTypes';
import { formatBRL } from '../data/mockData';
import { buildManualOrder, productNeedsProduction } from '../production/fromSale';
import { HISTORY_ACTOR, canMove, canSetStatus, historyLabel } from '../production/productionRules';
import { loadCatalog } from '../products/catalogStore';
import { ProductThumb } from '../products/ProductVisuals';
import type { CatalogProduct } from '../products/catalogTypes';
import type { ProductionFocus, ProductionOrder, ProductionPriority, ProductionStatus } from '../types';

interface ProductionPageProps {
  orders: ProductionOrder[];
  onUpdateStatus: (order: ProductionOrder) => Promise<void>;
  focus?: ProductionFocus | null;
}

type ViewMode = 'kanban' | 'list';
type BoardFilter = 'todos' | 'aguardando' | 'em_producao' | 'pronto' | 'atrasados' | ProductionStatus;
type PriorityFilter = 'todas' | 'normal' | 'alta' | 'urgente';
type DeadlineFilter = 'todos' | 'hoje' | 'proximos' | 'atrasados';
type SortKey = 'prazo_asc' | 'prazo_desc' | 'entrada_desc' | 'entrada_asc' | 'prioridade';

const TODAY = new Date().toISOString().slice(0, 10);
const PAGE_SIZE = 8;

const STATUS_LABEL: Record<ProductionStatus, string> = {
  arte_aprovacao: 'Aguardando arte',
  pre_impressao: 'Pré-impressão',
  producao: 'Em produção',
  acabamento: 'Acabamento',
  pronto: 'Pronto',
  entregue: 'Entregue',
};

const COLUMNS: Array<{ id: string; label: string; statuses: ProductionStatus[] }> = [
  { id: 'aguardando', label: 'Aguardando', statuses: ['arte_aprovacao', 'pre_impressao'] },
  { id: 'producao', label: 'Em produção', statuses: ['producao', 'acabamento'] },
  { id: 'pronto', label: 'Pronto', statuses: ['pronto'] },
  { id: 'entregue', label: 'Entregue', statuses: ['entregue'] },
];

function focusToFilter(focus: ProductionFocus): BoardFilter {
  if (focus === 'aprovacao') return 'arte_aprovacao';
  if (focus === 'em_producao') return 'em_producao';
  if (focus === 'pronto') return 'pronto';
  return 'atrasados';
}

function isLate(order: ProductionOrder): boolean {
  return order.status !== 'entregue' && order.dueDate < TODAY;
}

function isSoon(order: ProductionOrder): boolean {
  return !isLate(order) && order.status !== 'entregue' && order.dueDate <= shiftDate(1);
}

function shiftDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function columnOf(order: ProductionOrder): string {
  return COLUMNS.find((column) => column.statuses.includes(order.status))?.id ?? 'aguardando';
}

function guessCategory(name: string): CatalogProduct['category'] {
  const text = name.toLowerCase();
  if (text.includes('camiseta') || text.includes('polo') || text.includes('uniforme')) return 'Uniformes';
  if (text.includes('laser') || text.includes('acrílico') || text.includes('acrilico')) return 'Personalização a laser';
  if (text.includes('banner') || text.includes('adesivo') || text.includes('wind')) return 'Comunicação visual';
  if (text.includes('caneca') || text.includes('copo')) return 'Personalização';
  if (text.includes('sacola') || text.includes('caixa')) return 'Outros';
  return 'Impressão gráfica';
}

export function ProductionPage({ orders, onUpdateStatus, focus = null }: ProductionPageProps) {
  const [view, setView] = useState<ViewMode>('kanban');
  const [query, setQuery] = useState('');
  const [boardFilter, setBoardFilter] = useState<BoardFilter>('todos');
  const [priority, setPriority] = useState<PriorityFilter>('todas');
  const [deadline, setDeadline] = useState<DeadlineFilter>('todos');
  const [sortKey, setSortKey] = useState<SortKey>('prazo_asc');
  const [dragId, setDragId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<'pedido' | 'arte' | 'tecnico' | 'notas'>('pedido');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [category, setCategory] = useState('todas');
  const [clientFilter, setClientFilter] = useState('todos');
  const [enteredFrom, setEnteredFrom] = useState('');
  const [enteredTo, setEnteredTo] = useState('');
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setBoardFilter(focus ? focusToFilter(focus) : 'todos');
  }, [focus]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const counts = {
    waiting: orders.filter((order) => columnOf(order) === 'aguardando').length,
    running: orders.filter((order) => columnOf(order) === 'producao').length,
    done: orders.filter((order) => order.status === 'pronto').length,
    late: orders.filter(isLate).length,
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = orders.filter((order) => {
      if (q && !`${order.code} ${order.saleCode ?? ''} ${order.clientName} ${order.productName}`.toLowerCase().includes(q)) return false;
      if (category !== 'todas' && (order.category || guessCategory(order.productName)) !== category) return false;
      if (clientFilter !== 'todos' && order.clientId !== clientFilter) return false;
      const entered = order.enteredAt?.slice(0, 10) ?? '';
      if (enteredFrom && (!entered || entered < enteredFrom)) return false;
      if (enteredTo && (!entered || entered > enteredTo)) return false;
      if (boardFilter === 'aguardando' && columnOf(order) !== 'aguardando') return false;
      if (boardFilter === 'em_producao' && columnOf(order) !== 'producao') return false;
      if (boardFilter === 'pronto' && order.status !== 'pronto') return false;
      if (boardFilter === 'atrasados' && !isLate(order)) return false;
      if (boardFilter !== 'todos' && boardFilter !== 'aguardando' && boardFilter !== 'em_producao' && boardFilter !== 'pronto' && boardFilter !== 'atrasados' && order.status !== boardFilter) return false;
      if (priority !== 'todas' && order.priority !== priority) return false;
      if (deadline === 'hoje' && order.dueDate !== TODAY) return false;
      if (deadline === 'proximos' && !isSoon(order)) return false;
      if (deadline === 'atrasados' && !isLate(order)) return false;
      return true;
    });
    list.sort((a, b) => {
      const rank = { urgente: 0, alta: 1, normal: 2 };
      if (sortKey === 'prioridade') return rank[a.priority] - rank[b.priority];
      if (sortKey === 'entrada_desc') return (b.enteredAt ?? b.code).localeCompare(a.enteredAt ?? a.code);
      if (sortKey === 'entrada_asc') return (a.enteredAt ?? a.code).localeCompare(b.enteredAt ?? b.code);
      if (sortKey === 'prazo_desc') return b.dueDate.localeCompare(a.dueDate);
      return a.dueDate.localeCompare(b.dueDate);
    });
    return list;
  }, [orders, query, boardFilter, priority, deadline, sortKey, category, clientFilter, enteredFrom, enteredTo]);

  useEffect(() => setPage(1), [query, boardFilter, priority, deadline, sortKey, category, clientFilter, enteredFrom, enteredTo, view]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selected = orders.find((order) => order.id === openId) ?? null;

  const saveOrder = async (order: ProductionOrder, label: string) => {
    const next: ProductionOrder = {
      ...order,
      history: [...(order.history ?? []), { id: `hist-${Date.now()}`, at: new Date().toISOString(), label, by: HISTORY_ACTOR }],
    };
    try {
      await onUpdateStatus(next);
      setNotice({ tone: 'ok', text: label });
    } catch (error) {
      setNotice({ tone: 'err', text: error instanceof Error ? error.message : 'Não foi possível salvar o pedido.' });
    }
  };

  const changeStatus = (order: ProductionOrder, status: ProductionStatus, extra: Partial<ProductionOrder> = {}) => {
    const check = canSetStatus(order, status);
    if (!check.ok) {
      setNotice({ tone: 'err', text: check.message ?? 'Esta alteração de status não é permitida.' });
      return;
    }
    const approved = order.status === 'arte_aprovacao' && status === 'pre_impressao';
    void saveOrder(
      {
        ...order,
        ...extra,
        status,
        approval: approved ? 'aprovada' : order.approval,
        deliveredAt: status === 'entregue' ? new Date().toISOString() : order.deliveredAt,
      },
      approved ? 'Arte aprovada. Pedido aguardando início.' : historyLabel(status)
    );
  };

  const moveToColumn = (order: ProductionOrder, column: 'aguardando' | 'producao' | 'pronto' | 'entregue') => {
    const result = canMove(order, column);
    if (!result.ok || !result.status) {
      setNotice({ tone: 'err', text: result.message ?? 'Esta mudança de etapa não é permitida.' });
      return;
    }
    changeStatus(order, result.status);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-[#071A34] tracking-[-0.015em]">Produção</h2>
          <p className="text-[12.5px] text-[#5A6B82] mt-0.5">Acompanhe pedidos, prazos e etapas da gráfica.</p>
        </div>
        <div className="inline-flex h-8 items-center rounded-lg bg-[#EEF2F6] p-0.5">
          <button type="button" aria-label="Visualizar em kanban" onClick={() => setView('kanban')} className={`h-7 w-8 rounded-md inline-flex items-center justify-center ${view === 'kanban' ? 'bg-white text-[#071A34] shadow-[0_1px_2px_rgba(7,26,52,0.08)]' : 'text-[#8A98AB]'}`}><LayoutGrid className="w-3.5 h-3.5" /></button>
          <button type="button" aria-label="Visualizar em lista" onClick={() => setView('list')} className={`h-7 w-8 rounded-md inline-flex items-center justify-center ${view === 'list' ? 'bg-white text-[#071A34] shadow-[0_1px_2px_rgba(7,26,52,0.08)]' : 'text-[#8A98AB]'}`}><List className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Indicator icon={Clock} label="Aguardando" value={counts.waiting} active={boardFilter === 'aguardando'} onClick={() => setBoardFilter('aguardando')} />
        <Indicator icon={Package} label="Em produção" value={counts.running} active={boardFilter === 'em_producao'} onClick={() => setBoardFilter('em_producao')} />
        <Indicator icon={CheckCircle2} label="Prontos" value={counts.done} active={boardFilter === 'pronto'} onClick={() => setBoardFilter('pronto')} />
        <Indicator icon={AlertCircle} label="Atrasados" value={counts.late} active={boardFilter === 'atrasados'} onClick={() => setBoardFilter('atrasados')} />
      </div>

      {notice && (
        <div role="status" className={`rounded-lg px-3 py-2 text-[12.5px] ${notice.tone === 'err' ? 'bg-amber-50 text-amber-950' : 'bg-emerald-50 text-emerald-800'}`}>
          {notice.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[180px] flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-[#8A98AB] absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pedido, venda, cliente ou produto" aria-label="Buscar pedido" className="h-9 w-full rounded-lg border border-[#E4EAF1] bg-white pl-8 pr-3 text-[12.5px] outline-none focus:border-[#C5D0DE]" />
        </label>
        <SelectMenu value={boardFilter} ariaLabel="Filtrar por status" onChange={setBoardFilter} options={[{ value: 'todos', label: 'Todos os status' }, { value: 'aguardando', label: 'Aguardando' }, { value: 'em_producao', label: 'Em produção' }, { value: 'pronto', label: 'Prontos' }, { value: 'atrasados', label: 'Atrasados' }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value: value as ProductionStatus, label }))]} />
        <SelectMenu value={priority} ariaLabel="Filtrar por prioridade" onChange={setPriority} options={[{ value: 'todas', label: 'Prioridade' }, { value: 'normal', label: 'Normal' }, { value: 'alta', label: 'Prioritário' }, { value: 'urgente', label: 'Urgente' }]} />
        <SelectMenu value={deadline} ariaLabel="Filtrar por prazo" onChange={setDeadline} options={[{ value: 'todos', label: 'Prazo' }, { value: 'hoje', label: 'Hoje' }, { value: 'proximos', label: 'Próximos' }, { value: 'atrasados', label: 'Atrasados' }]} />
        <SelectMenu value={sortKey} ariaLabel="Ordenar pedidos" onChange={setSortKey} options={[{ value: 'prazo_asc', label: 'Prazo mais próximo' }, { value: 'prazo_desc', label: 'Prazo mais distante' }, { value: 'prioridade', label: 'Prioridade' }, { value: 'entrada_desc', label: 'Entrada mais recente' }, { value: 'entrada_asc', label: 'Entrada mais antiga' }]} />
        <SelectMenu value={category} ariaLabel="Filtrar por categoria" onChange={setCategory} options={[{ value: 'todas', label: 'Categoria' }, ...Array.from(new Set(orders.map((order) => order.category || guessCategory(order.productName)))).map((item) => ({ value: item, label: item }))]} />
        <SelectMenu value={clientFilter} ariaLabel="Filtrar por cliente" onChange={setClientFilter} options={[{ value: 'todos', label: 'Cliente' }, ...Array.from(new Map(orders.map((order) => [order.clientId, order.clientName])).entries()).map(([value, label]) => ({ value, label }))]} />
        <input type="date" value={enteredFrom} onChange={(event) => setEnteredFrom(event.target.value)} aria-label="Entrada a partir de" className="h-9 rounded-lg border border-[#E4EAF1] bg-white px-2 text-[12.5px] text-[#071A34]" />
        <input type="date" value={enteredTo} onChange={(event) => setEnteredTo(event.target.value)} aria-label="Entrada até" className="h-9 rounded-lg border border-[#E4EAF1] bg-white px-2 text-[12.5px] text-[#071A34]" />
        <button type="button" onClick={() => setCreating(true)} className="h-9 px-3 rounded-lg bg-[#071A34] text-white text-[12.5px]">Novo pedido</button>
      </div>

      {orders.length === 0 ? (
        <Empty title="Nenhum pedido em produção" text="Quando uma venda gerar produção, os pedidos aparecem aqui." />
      ) : filtered.length === 0 ? (
        <Empty title="Nenhum pedido encontrado" text="Ajuste a busca ou os filtros para ver outros pedidos." />
      ) : view === 'kanban' ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {COLUMNS.map((column) => {
            const items = filtered.filter((order) => columnOf(order) === column.id);
            return (
              <section
                key={column.id}
                className={`min-w-[240px] flex-1 rounded-xl ${overColumn === column.id ? 'bg-[#F4F7FB]' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setOverColumn(column.id);
                }}
                onDragLeave={() => setOverColumn((current) => (current === column.id ? null : current))}
                onDrop={() => {
                  const order = orders.find((item) => item.id === dragId);
                  if (order) moveToColumn(order, column.id as 'aguardando' | 'producao' | 'pronto' | 'entregue');
                  setDragId(null);
                  setOverColumn(null);
                }}
              >
                <div className="mb-2 flex items-center justify-between px-1">
                  <h3 className="text-[12.5px] font-semibold text-[#071A34]">{column.label}</h3>
                  <span className="text-[11px] text-[#8A98AB]">{items.length}</span>
                </div>
                <div className="space-y-2 max-h-[calc(100vh-16rem)] overflow-y-auto pr-1">
                  {items.length === 0 ? <p className="px-1 py-6 text-[12px] text-[#8A98AB]">Nenhum pedido.</p> : items.map((order) => (
                    <OrderCard key={order.id} order={order} onOpen={() => { setOpenId(order.id); setTab('pedido'); }} onStatus={(status) => changeStatus(order, status)} onDragStart={() => setDragId(order.id)} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-[#EEF2F7] text-[11.5px] text-[#5A6B82]">
                <th className="py-2.5 pr-3 font-medium">Pedido</th>
                <th className="py-2.5 pr-3 font-medium">Cliente</th>
                <th className="py-2.5 pr-3 font-medium">Produto</th>
                <th className="py-2.5 pr-3 font-medium text-right">Qtd.</th>
                <th className="py-2.5 pr-3 font-medium">Prazo</th>
                <th className="py-2.5 pr-3 font-medium">Prioridade</th>
                <th className="py-2.5 pr-3 font-medium">Status</th>
                <th className="py-2.5 font-medium"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] text-[13px]">
              {visible.map((order) => (
                <tr key={order.id} className={isLate(order) ? 'bg-amber-50/40' : ''}>
                  <td className="py-2.5 pr-3 font-medium text-[#071A34]">{order.code}</td>
                  <td className="py-2.5 pr-3">{order.clientName}</td>
                  <td className="py-2.5 pr-3 max-w-[220px] truncate text-[#5A6B82]">{order.productName}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{order.quantity}</td>
                  <td className={`py-2.5 pr-3 whitespace-nowrap ${isLate(order) ? 'text-amber-800' : 'text-[#5A6B82]'}`}>{order.dueLabel}</td>
                  <td className="py-2.5 pr-3">{order.priority === 'urgente' ? 'Urgente' : order.priority === 'alta' ? 'Prioritário' : 'Normal'}</td>
                  <td className="py-2.5 pr-3">
                    <select aria-label={`Status de ${order.code}`} value={order.status} onChange={(event) => changeStatus(order, event.target.value as ProductionStatus)} className="h-8 max-w-[150px] rounded-lg border border-[#E4EAF1] bg-white px-2 text-[12px]">
                      {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => { setOpenId(order.id); setTab('pedido'); }} className="text-[12px] text-[#071A34]">Abrir</button>
                      <button type="button" onClick={() => { setOpenId(order.id); setTab('arte'); }} className="text-[12px] text-[#5A6B82]">Arquivos</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-between text-[12px] text-[#5A6B82]">
              <span>Página {page} de {pageCount}</span>
              <div className="flex gap-1">
                <button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="h-8 px-2 rounded-lg border border-[#E4EAF1] bg-white disabled:opacity-40">Anterior</button>
                <button type="button" disabled={page === pageCount} onClick={() => setPage((value) => value + 1)} className="h-8 px-2 rounded-lg border border-[#E4EAF1] bg-white disabled:opacity-40">Próxima</button>
              </div>
            </div>
          )}
        </div>
      )}

      {selected && (
        <OrderDrawer
          order={selected}
          tab={tab}
          onTab={setTab}
          onClose={() => setOpenId(null)}
          onStatus={(status, extra) => changeStatus(selected, status, extra)}
          onSave={(patch, label) => { void saveOrder({ ...selected, ...patch }, label); }}
        />
      )}
      {creating && (
        <ManualOrder
          onClose={() => setCreating(false)}
          onCreate={async (order) => {
            try {
              await onUpdateStatus(order);
              setNotice({ tone: 'ok', text: 'Pedido manual registrado na produção.' });
              setCreating(false);
            } catch (error) {
              setNotice({ tone: 'err', text: error instanceof Error ? error.message : 'Não foi possível registrar o pedido.' });
              throw error;
            }
          }}
        />
      )}
    </div>
  );
}

function Indicator({ icon: Icon, label, value, active, onClick }: { icon: typeof Clock; label: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`flex items-center gap-2 rounded-lg px-1 py-1 ${active ? 'text-[#071A34]' : 'text-[#5A6B82]'}`}>
      <Icon className="w-4 h-4" strokeWidth={1.75} />
      <span className="text-left"><span className="block text-[16px] font-semibold leading-none tabular-nums text-[#071A34]">{value}</span><span className="text-[11.5px]">{label}</span></span>
    </button>
  );
}

function OrderCard({ order, onOpen, onStatus, onDragStart }: { order: ProductionOrder; onOpen: () => void; onStatus: (status: ProductionStatus) => void; onDragStart: () => void }) {
  const late = isLate(order);
  const category = guessCategory(order.productName);
  return (
    <article draggable onDragStart={onDragStart} className={`rounded-xl border bg-white p-2.5 cursor-grab ${late ? 'border-amber-200' : 'border-[#E7EDF3]'}`}>
      <button type="button" onClick={onOpen} className="w-full text-left">
        <div className="flex gap-2">
          <ProductThumb product={{ name: order.productName, category, image: null }} className="h-12 w-12 rounded-lg shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-[#8A98AB]">{order.code}</span>
              {order.priority !== 'normal' && <span className="text-[10.5px] text-[#9A7220]">{order.priority === 'urgente' ? 'Urgente' : 'Prioritário'}</span>}
            </div>
            <div className="text-[12.5px] font-semibold text-[#071A34] truncate">{order.clientName}</div>
            <div className="text-[11.5px] text-[#5A6B82] truncate">{order.quantity}× {order.productName}</div>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span className={late ? 'text-amber-800' : isSoon(order) ? 'text-[#9A7220]' : 'text-[#8A98AB]'}>{late ? 'Atrasado · ' : ''}{order.dueLabel}</span>
          {order.status === 'arte_aprovacao' && <span className="text-[#5A6B82]">Aprovar arte</span>}
        </div>
      </button>
      <div className="mt-2">
        <SelectMenu value={order.status} ariaLabel={`Status de ${order.code}`} className="w-full max-w-none" onChange={onStatus} options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value: value as ProductionStatus, label }))} />
      </div>
    </article>
  );
}

function OrderDrawer({ order, tab, onTab, onClose, onStatus, onSave }: { order: ProductionOrder; tab: 'pedido' | 'arte' | 'tecnico' | 'notas'; onTab: (tab: 'pedido' | 'arte' | 'tecnico' | 'notas') => void; onClose: () => void; onStatus: (status: ProductionStatus, extra?: Partial<ProductionOrder>) => void; onSave: (patch: Partial<ProductionOrder>, label: string) => void }) {
  const category = guessCategory(order.category || order.productName);
  const specs = order.technical && order.technical.length > 0 ? order.technical : specsFromName(order.productName);
  const [activities, setActivities] = useState<ClientActivity[]>([]);
  const [priority, setPriority] = useState<ProductionPriority>(order.priority);
  const [dueDate, setDueDate] = useState(order.dueDate);
  const [clientNote, setClientNote] = useState(order.clientNote ?? '');
  const [internalNote, setInternalNote] = useState(order.internalNote ?? '');
  const [generalNote, setGeneralNote] = useState(order.generalNote ?? '');
  const [deliveryNote, setDeliveryNote] = useState(order.deliveryNote ?? '');
  useEffect(() => {
    setPriority(order.priority);
    setDueDate(order.dueDate);
    setClientNote(order.clientNote ?? '');
    setInternalNote(order.internalNote ?? '');
    setGeneralNote(order.generalNote ?? '');
    setDeliveryNote(order.deliveryNote ?? '');
    loadActivities().then(setActivities).catch(() => setActivities([]));
  }, [order]);
  const pinned = order.files ?? [];
  const laterArts = (activities.find((item) => item.clientId === order.clientId)?.arts ?? []).filter(
    (art) => !pinned.some((file) => file.id === art.id)
  );
  const tabs = [
    { id: 'pedido' as const, label: 'Pedido' },
    { id: 'arte' as const, label: 'Arte' },
    { id: 'tecnico' as const, label: 'Técnico' },
    { id: 'notas' as const, label: 'Observações' },
  ];
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" className="absolute inset-0 bg-[#071A34]/20" aria-label="Fechar pedido" onClick={onClose} />
      <aside className="relative h-full w-full max-w-md bg-white border-l border-[#E4EAF1] flex flex-col">
        <div className="px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[16px] font-semibold text-[#071A34]">{order.code}</h3>
            <p className="text-[12.5px] text-[#5A6B82]">{order.clientName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar"><X className="w-4 h-4 text-[#8A98AB]" /></button>
        </div>
        <div className="px-5 flex gap-1">
          {tabs.map((item) => <button key={item.id} type="button" onClick={() => onTab(item.id)} className={`h-8 px-3 rounded-lg text-[12.5px] ${tab === item.id ? 'bg-[#071A34] text-white' : 'text-[#5A6B82]'}`}>{item.label}</button>)}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-[12.5px]">
          {tab === 'pedido' && (
            <dl className="grid grid-cols-2 gap-3">
              <Info label="Produto" value={order.productName} />
              <Info label="Quantidade" value={String(order.quantity)} />
              <Info label="Venda" value={order.saleCode || '—'} />
              <Info label="Entrada" value={order.enteredAt ? new Date(order.enteredAt).toLocaleDateString('pt-BR') : '—'} />
              <Info label="Status" value={STATUS_LABEL[order.status]} />
              <Info label="Valor" value={formatBRL(order.value)} />
              <label className="block text-[11px] text-[#8A98AB]">Prioridade
                <select value={priority} onChange={(event) => setPriority(event.target.value as ProductionPriority)} className="mt-1 h-8 w-full rounded-lg border border-[#E4EAF1] px-2 text-[12.5px] text-[#071A34]">
                  <option value="normal">Normal</option>
                  <option value="alta">Prioritário</option>
                  <option value="urgente">Urgente</option>
                </select>
              </label>
              <label className="block text-[11px] text-[#8A98AB]">Prazo
                <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="mt-1 h-8 w-full rounded-lg border border-[#E4EAF1] px-2 text-[12.5px] text-[#071A34]" />
              </label>
              {order.deliveredAt && <Info label="Entrega" value={new Date(order.deliveredAt).toLocaleString('pt-BR')} />}
              {order.deliveryNote && <Info label="Informação da entrega" value={order.deliveryNote} />}
              <button type="button" onClick={() => {
                const changes = [
                  priority !== order.priority ? 'Prioridade alterada.' : '',
                  dueDate !== order.dueDate ? 'Prazo alterado.' : '',
                ].filter(Boolean);
                if (changes.length === 0 || !dueDate) return;
                onSave({ priority, dueDate, dueLabel: new Date(`${dueDate}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) }, changes.join(' '));
              }} className="h-8 px-3 rounded-lg border border-[#E4EAF1] text-[12px]">Salvar prazo e prioridade</button>
            </dl>
          )}
          {tab === 'arte' && (
            <div className="space-y-2">
              <ProductThumb product={{ name: order.productName, category, image: order.artUrl ? { id: order.id, name: order.artName || order.productName, dataUrl: order.artUrl } : null }} className="h-40 w-full rounded-xl" />
              <p className="text-[#5A6B82]">
                {order.approval === 'pendente' && 'Arte aguardando aprovação. A produção não começa antes disso.'}
                {order.approval === 'aprovada' && 'Arte aprovada para este pedido.'}
                {order.approval === 'nao_exige' && 'Este pedido não exige aprovação de arte.'}
                {!order.approval && 'Sem regra de aprovação registrada.'}
              </p>
              {pinned.length === 0 ? <p className="text-[#8A98AB]">Nenhum arquivo foi vinculado na entrada deste pedido.</p> : pinned.map((file) => (
                <div key={file.id} className="flex items-center justify-between gap-2 text-[#334155]">
                  <span className="min-w-0 truncate">{file.kind === 'arte' ? 'Arte' : 'Arquivo'} · {file.name}</span>
                  {file.url ? <button type="button" onClick={() => window.open(file.url, '_blank', 'noopener')} className="shrink-0 text-[#071A34]">Abrir</button> : <span className="shrink-0 text-[#8A98AB]">Biblioteca</span>}
                </div>
              ))}
              {laterArts.length > 0 && (
                <div className="space-y-1 pt-2">
                  <p className="text-[11px] text-[#8A98AB]">Versões posteriores no chat. A arte deste pedido permanece a que foi vinculada.</p>
                  {laterArts.map((art) => (
                    <div key={art.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{art.name}</span>
                      {art.previewUrl && <button type="button" onClick={() => window.open(art.previewUrl, '_blank', 'noopener')} className="text-[#071A34]">Abrir</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {tab === 'tecnico' && (
            specs.length === 0 ? <p className="text-[#8A98AB]">Sem especificações extras para este produto.</p> : (
              <dl className="grid grid-cols-2 gap-3">{specs.map((item) => <Info key={item.label} label={item.label} value={item.value} />)}</dl>
            )
          )}
          {tab === 'notas' && (
            <div className="space-y-2">
              <label className="block text-[11px] text-[#8A98AB]">Observação do cliente
                <textarea value={clientNote} onChange={(event) => setClientNote(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-[#E4EAF1] px-2 py-1.5 text-[12.5px] text-[#071A34] resize-none" />
              </label>
              <label className="block text-[11px] text-[#8A98AB]">Instrução interna
                <textarea value={internalNote} onChange={(event) => setInternalNote(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-[#E4EAF1] px-2 py-1.5 text-[12.5px] text-[#071A34] resize-none" />
              </label>
              <label className="block text-[11px] text-[#8A98AB]">Observação geral
                <textarea value={generalNote} onChange={(event) => setGeneralNote(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-[#E4EAF1] px-2 py-1.5 text-[12.5px] text-[#071A34] resize-none" />
              </label>
              <button type="button" onClick={() => onSave({ clientNote, internalNote, generalNote }, 'Observação de produção atualizada.')} className="h-8 px-3 rounded-lg bg-[#071A34] text-white text-[12px]">Salvar observações</button>
              <div className="pt-2 space-y-1">
                {(order.history ?? []).map((entry) => <p key={entry.id} className="text-[12px] text-[#5A6B82]">{new Date(entry.at).toLocaleString('pt-BR')} · {entry.label} · {entry.by}</p>)}
                {(order.history ?? []).length === 0 && <p className="text-[12px] text-[#8A98AB]">Sem histórico registrado.</p>}
              </div>
            </div>
          )}
        </div>
        <div className="px-5 py-3 flex flex-wrap justify-end gap-2">
          {order.status === 'arte_aprovacao' && <button type="button" onClick={() => onStatus('pre_impressao')} className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px]">Aprovar arte</button>}
          {order.status === 'pre_impressao' && <button type="button" onClick={() => onStatus('producao')} className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px]">Iniciar produção</button>}
          {order.status !== 'pronto' && order.status !== 'entregue' && order.status !== 'arte_aprovacao' && <button type="button" onClick={() => onStatus('pronto')} className="h-9 px-3 rounded-lg bg-[#071A34] text-white text-[12.5px]">Marcar como pronto</button>}
          {order.status === 'pronto' && (
            <>
              <input value={deliveryNote} onChange={(event) => setDeliveryNote(event.target.value)} placeholder="Informação da entrega" aria-label="Informação da entrega" className="h-9 min-w-0 flex-1 rounded-lg border border-[#E4EAF1] px-2 text-[12.5px]" />
              <button type="button" onClick={() => onStatus('entregue', { deliveryNote })} className="h-9 px-3 rounded-lg bg-[#071A34] text-white text-[12.5px]">Marcar como entregue</button>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-[11px] text-[#8A98AB]">{label}</dt><dd className="text-[#071A34] mt-0.5">{value}</dd></div>;
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className="py-16 text-center"><MoreHorizontal className="w-5 h-5 mx-auto text-[#8A98AB]" /><h3 className="mt-3 text-[14px] font-semibold text-[#071A34]">{title}</h3><p className="mt-1 text-[12.5px] text-[#5A6B82]">{text}</p></div>;
}

function ManualOrder({ onClose, onCreate }: { onClose: () => void; onCreate: (order: ProductionOrder) => Promise<void> }) {
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [activities, setActivities] = useState<ClientActivity[]>([]);
  const [clientId, setClientId] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [dueDate, setDueDate] = useState(shiftDate(2));
  const [priority, setPriority] = useState<ProductionPriority>('normal');
  const [clientNote, setClientNote] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    Promise.all([loadClients(), loadCatalog(), loadActivities()])
      .then(([clientItems, productItems, activityItems]) => {
        const activeClients = clientItems.filter((client) => client.status === 'ativo');
        const producible = productItems.filter((product) => product.status === 'ativo' && productNeedsProduction(product));
        setClients(activeClients);
        setProducts(producible);
        setActivities(activityItems);
        setClientId(activeClients[0]?.id ?? '');
        setProductId(producible[0]?.id ?? '');
      })
      .catch(() => setError('Não foi possível carregar clientes e produtos.'));
  }, []);
  const submit = async () => {
    const client = clients.find((item) => item.id === clientId);
    const product = products.find((item) => item.id === productId);
    const amount = Number(quantity);
    if (!client || !product) {
      setError('Escolha um cliente e um produto que exigem produção.');
      return;
    }
    if (!Number.isFinite(amount) || amount < 1 || !dueDate) {
      setError('Informe quantidade e prazo válidos.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onCreate(buildManualOrder({
        clientId: client.id,
        clientName: client.company || client.name,
        product,
        quantity: amount,
        dueDate,
        priority,
        clientNote: clientNote.trim(),
        internalNote: internalNote.trim(),
        activities,
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível registrar o pedido.');
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-[#071A34]/20" aria-label="Fechar novo pedido" onClick={onClose} />
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="relative w-full max-w-md rounded-xl border border-[#E4EAF1] bg-white p-5 space-y-3">
        <h3 className="text-[15px] font-semibold text-[#071A34]">Novo pedido de produção</h3>
        <label className="block text-[11px] text-[#8A98AB]">Cliente
          <select value={clientId} onChange={(event) => setClientId(event.target.value)} aria-label="Cliente do pedido" className="mt-1 h-9 w-full rounded-lg border border-[#E4EAF1] px-2 text-[12.5px] text-[#071A34]">
            {clients.map((client) => <option key={client.id} value={client.id}>{client.company || client.name}</option>)}
          </select>
        </label>
        <label className="block text-[11px] text-[#8A98AB]">Produto
          <select value={productId} onChange={(event) => setProductId(event.target.value)} aria-label="Produto do pedido" className="mt-1 h-9 w-full rounded-lg border border-[#E4EAF1] px-2 text-[12.5px] text-[#071A34]">
            {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="block text-[11px] text-[#8A98AB]">Quantidade
            <input value={quantity} onChange={(event) => setQuantity(event.target.value)} aria-label="Quantidade" className="mt-1 h-9 w-full rounded-lg border border-[#E4EAF1] px-2 text-[12.5px]" />
          </label>
          <label className="block text-[11px] text-[#8A98AB]">Prazo
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} aria-label="Prazo do pedido" className="mt-1 h-9 w-full rounded-lg border border-[#E4EAF1] px-2 text-[12.5px]" />
          </label>
          <label className="block text-[11px] text-[#8A98AB]">Prioridade
            <select value={priority} onChange={(event) => setPriority(event.target.value as ProductionPriority)} aria-label="Prioridade do pedido" className="mt-1 h-9 w-full rounded-lg border border-[#E4EAF1] px-2 text-[12.5px]">
              <option value="normal">Normal</option>
              <option value="alta">Prioritário</option>
              <option value="urgente">Urgente</option>
            </select>
          </label>
        </div>
        <textarea value={clientNote} onChange={(event) => setClientNote(event.target.value)} rows={2} placeholder="Observação do cliente" aria-label="Observação do cliente" className="w-full rounded-lg border border-[#E4EAF1] px-2 py-1.5 text-[12.5px] resize-none" />
        <textarea value={internalNote} onChange={(event) => setInternalNote(event.target.value)} rows={2} placeholder="Instrução interna" aria-label="Instrução interna" className="w-full rounded-lg border border-[#E4EAF1] px-2 py-1.5 text-[12.5px] resize-none" />
        {products.length === 0 && <p className="text-[12px] text-[#8A98AB]">Nenhum produto ativo com especificação de produção.</p>}
        {error && <p className="text-[12px] text-amber-900">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px]">Cancelar</button>
          <button type="submit" disabled={saving || products.length === 0} className="h-9 px-3 rounded-lg bg-[#071A34] text-white text-[12.5px] disabled:opacity-40">{saving ? 'Salvando…' : 'Registrar'}</button>
        </div>
      </form>
    </div>
  );
}

function specsFromName(name: string): Array<{ label: string; value: string }> {
  const text = name.toLowerCase();
  const specs: Array<{ label: string; value: string }> = [];
  if (text.includes('couchê') || text.includes('couche')) specs.push({ label: 'Material', value: 'Couchê' });
  if (text.includes('lona')) specs.push({ label: 'Material', value: 'Lona' });
  if (text.includes('kraft')) specs.push({ label: 'Material', value: 'Kraft' });
  if (text.includes('sublim')) specs.push({ label: 'Impressão', value: 'Sublimação' });
  if (text.includes('hot stamping')) specs.push({ label: 'Acabamento', value: 'Hot stamping' });
  if (text.includes('recorte')) specs.push({ label: 'Acabamento', value: 'Recorte' });
  return specs;
}
