import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  LayoutGrid,
  List,
  Mail,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Search,
  ShoppingBag,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { SelectMenu } from '../components/SelectMenu';
import {
  CLIENTS,
  FILE_ASSETS,
  INITIAL_SALES,
  PROJECT_THREADS,
  formatBRL,
} from '../data/mockData';
import type { ClientRecord, NavPageId } from '../types';

interface ClientsPageProps {
  globalSearch: string;
  onBreadcrumbChange: (crumb: string | null) => void;
  onNavigate: (page: NavPageId) => void;
}

type ClientKind = 'pf' | 'pj';
type ClientStatus = 'ativo' | 'inativo';
type ViewMode = 'cards' | 'list';
type SortKey = 'name' | 'created' | 'recent' | 'volume';
type ProfileTab = 'dados' | 'projetos' | 'arquivos' | 'compras' | 'observacoes';

interface ClientCard extends ClientRecord {
  kind: ClientKind;
  status: ClientStatus;
  createdAt: string;
  notes: string;
}

const PAGE_SIZE = 8;

const EXTRA_CLIENTS: ClientCard[] = [
  {
    id: 'cli-6',
    name: 'Ana Ribeiro',
    company: 'Ana Ribeiro',
    initials: 'AR',
    accentColor: '#1E3A5F',
    email: 'ana.ribeiro@email.com',
    phone: '(11) 99620-4418',
    document: '402.118.903-22',
    city: 'São Paulo, SP',
    totalSpent: 320,
    ordersCount: 1,
    activeProjects: 0,
    lastActivity: 'Hoje, 08:20',
    kind: 'pf',
    status: 'ativo',
    createdAt: '2026-11-20',
    notes: 'Pedido avulso de cartões pessoais.',
  },
  {
    id: 'cli-7',
    name: 'Paulo Mendes',
    company: 'Paulo Mendes',
    initials: 'PM',
    accentColor: '#5C6B7A',
    email: '',
    phone: '(11) 98810-2204',
    document: '318.552.109-40',
    city: 'Osasco, SP',
    totalSpent: 0,
    ordersCount: 0,
    activeProjects: 0,
    lastActivity: '12 Out',
    kind: 'pf',
    status: 'inativo',
    createdAt: '2026-08-02',
    notes: 'Cadastro antigo, sem compras no período.',
  },
];

function toCard(client: ClientRecord, index: number): ClientCard {
  return {
    ...client,
    kind: client.document.includes('/') ? 'pj' : 'pf',
    status: 'ativo',
    createdAt: ['2026-01-14', '2026-03-02', '2026-05-19', '2026-06-08', '2026-09-11'][index] ?? '2026-10-01',
    notes: '',
  };
}

export function ClientsPage({ globalSearch, onBreadcrumbChange, onNavigate: _onNavigate }: ClientsPageProps) {
  const [clients, setClients] = useState<ClientCard[]>(() => [
    ...CLIENTS.map(toCard),
    ...EXTRA_CLIENTS,
  ]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'todos' | ClientKind>('todos');
  const [status, setStatus] = useState<'todos' | ClientStatus>('todos');
  const [activity, setActivity] = useState<'todas' | 'recentes' | 'compras' | 'sem'>('todas');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [view, setView] = useState<ViewMode>('cards');
  const [page, setPage] = useState(1);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ClientCard | null>(null);
  const [tab, setTab] = useState<ProfileTab>('dados');
  const [editor, setEditor] = useState<ClientCard | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 240);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    onBreadcrumbChange(profile ? profile.company : null);
    return () => onBreadcrumbChange(null);
  }, [profile, onBreadcrumbChange]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!menuId) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (menuRef.current?.contains(target) || target?.closest('[data-client-menu]')) return;
      setMenuId(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuId]);

  const filtered = useMemo(() => {
    const local = query.trim().toLowerCase();
    const global = globalSearch.trim().toLowerCase();
    const list = clients.filter((client) => {
      if (kind !== 'todos' && client.kind !== kind) return false;
      if (status !== 'todos' && client.status !== status) return false;
      const recent = /hoje|ontem/i.test(client.lastActivity);
      if (activity === 'recentes' && !recent) return false;
      if (activity === 'compras' && client.ordersCount === 0) return false;
      if (activity === 'sem' && client.ordersCount > 0) return false;
      const hay = `${client.name} ${client.company} ${client.phone} ${client.email} ${client.document}`.toLowerCase();
      if (local && !hay.includes(local)) return false;
      if (global && !hay.includes(global)) return false;
      return true;
    });
    list.sort((a, b) => compareClients(a, b, sortKey));
    return list;
  }, [clients, query, globalSearch, kind, status, activity, sortKey]);

  useEffect(() => {
    setPage(1);
  }, [query, globalSearch, kind, status, activity, sortKey, view]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const filtersActive = query.trim().length > 0 || kind !== 'todos' || status !== 'todos' || activity !== 'todas';

  const stats = {
    total: clients.length,
    active: clients.filter((client) => client.status === 'ativo').length,
    recent: clients.filter((client) => /hoje|ontem/i.test(client.lastActivity)).length,
    buyers: clients.filter((client) => client.ordersCount > 0).length,
  };

  const openProfile = (client: ClientCard, nextTab: ProfileTab = 'dados') => {
    setProfile(client);
    setTab(nextTab);
    setMenuId(null);
  };

  const openCreate = () => {
    setCreating(true);
    setEditor(blankClient());
    setMenuId(null);
  };

  const openEdit = (client: ClientCard) => {
    setCreating(false);
    setEditor({ ...client });
    setMenuId(null);
  };

  const saveEditor = () => {
    if (!editor || !editor.name.trim()) return;
    const next = {
      ...editor,
      name: editor.name.trim(),
      company: editor.kind === 'pj' ? editor.company.trim() || editor.name.trim() : editor.name.trim(),
      initials: initialsOf(editor.kind === 'pj' ? editor.company || editor.name : editor.name),
    };
    setClients((current) => {
      const exists = current.some((item) => item.id === next.id);
      return exists ? current.map((item) => (item.id === next.id ? next : item)) : [next, ...current];
    });
    setProfile((current) => (current?.id === next.id ? next : current));
    setEditor(null);
    setNotice(creating ? 'Cliente cadastrado.' : 'Dados do cliente atualizados.');
  };

  const toggleStatus = (client: ClientCard) => {
    const nextStatus: ClientStatus = client.status === 'ativo' ? 'inativo' : 'ativo';
    const next = { ...client, status: nextStatus };
    setClients((current) => current.map((item) => (item.id === client.id ? next : item)));
    setProfile((current) => (current?.id === client.id ? next : current));
    setMenuId(null);
    setNotice(nextStatus === 'inativo' ? 'Cliente marcado como inativo.' : 'Cliente reativado.');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-[#071A34] tracking-[-0.015em]">Clientes</h2>
          <p className="text-[12.5px] text-[#5A6B82] mt-0.5">
            Gerencie clientes, dados, histórico e projetos.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="h-9 px-3.5 rounded-lg bg-[#071A34] text-white text-[12.5px] font-medium hover:bg-[#0D284D] inline-flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5 text-[#E3C16F]" />
          Novo cliente
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-7 gap-y-2">
        <Stat icon={Users} label="Total de clientes" value={String(stats.total)} />
        <Stat icon={UserRound} label="Clientes ativos" value={String(stats.active)} />
        <Stat icon={FolderOpen} label="Clientes recentes" value={String(stats.recent)} />
        <Stat icon={ShoppingBag} label="Clientes com compras" value={String(stats.buyers)} />
      </div>

      {notice && (
        <div role="status" className="rounded-lg px-3 py-2 text-[12.5px] bg-emerald-50 text-emerald-800">
          {notice}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-[#8A98AB] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nome, telefone, e-mail ou documento"
            aria-label="Buscar cliente"
            className="h-9 w-full rounded-lg border border-[#E4EAF1] bg-white pl-8 pr-3 text-[12.5px] text-[#0F1E36] outline-none focus:border-[#C5D0DE]"
          />
        </label>
        <SelectMenu
          value={kind}
          ariaLabel="Filtrar por tipo"
          onChange={setKind}
          options={[
            { value: 'todos', label: 'Todos os tipos' },
            { value: 'pj', label: 'Pessoa jurídica' },
            { value: 'pf', label: 'Pessoa física' },
          ]}
        />
        <SelectMenu
          value={status}
          ariaLabel="Filtrar por status"
          onChange={setStatus}
          options={[
            { value: 'todos', label: 'Todos os status' },
            { value: 'ativo', label: 'Ativos' },
            { value: 'inativo', label: 'Inativos' },
          ]}
        />
        <SelectMenu
          value={activity}
          ariaLabel="Filtrar por atividade"
          onChange={setActivity}
          options={[
            { value: 'todas', label: 'Toda a atividade' },
            { value: 'recentes', label: 'Recentes' },
            { value: 'compras', label: 'Com compras' },
            { value: 'sem', label: 'Sem compras' },
          ]}
        />
        <div className="ml-auto flex items-center gap-1.5">
          <SelectMenu
            value={sortKey}
            ariaLabel="Ordenar clientes"
            onChange={setSortKey}
            options={[
              { value: 'name', label: 'Nome' },
              { value: 'created', label: 'Data de cadastro' },
              { value: 'recent', label: 'Compras recentes' },
              { value: 'volume', label: 'Maior volume' },
            ]}
          />
          <div className="inline-flex h-8 items-center rounded-lg bg-[#EEF2F6] p-0.5">
            <button
              type="button"
              aria-label="Visualizar em cards"
              aria-pressed={view === 'cards'}
              onClick={() => setView('cards')}
              className={`h-7 w-7 rounded-md inline-flex items-center justify-center ${view === 'cards' ? 'bg-white text-[#071A34] shadow-[0_1px_2px_rgba(7,26,52,0.08)]' : 'text-[#8A98AB]'}`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              aria-label="Visualizar em lista"
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
              className={`h-7 w-7 rounded-md inline-flex items-center justify-center ${view === 'list' ? 'bg-white text-[#071A34] shadow-[0_1px_2px_rgba(7,26,52,0.08)]' : 'text-[#8A98AB]'}`}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-44 rounded-2xl bg-white border border-[#E7EDF3] animate-pulse" />
          ))}
        </div>
      ) : loadError ? (
        <EmptyState
          title="Não foi possível carregar os clientes"
          text="Tente novamente em instantes."
          actionLabel="Tentar de novo"
          onAction={() => {
            setLoadError(false);
            setLoading(true);
            window.setTimeout(() => setLoading(false), 240);
          }}
        />
      ) : clients.length === 0 ? (
        <EmptyState
          title="Nenhum cliente cadastrado"
          text="Cadastre o primeiro cliente para acompanhar contatos, projetos e compras."
          actionLabel="Novo cliente"
          onAction={openCreate}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Nenhum cliente encontrado"
          text={query.trim() ? `Não há resultados para “${query.trim()}”.` : 'Ajuste os filtros para ver outros clientes.'}
          actionLabel={filtersActive ? 'Limpar filtros' : undefined}
          onAction={
            filtersActive
              ? () => {
                  setQuery('');
                  setKind('todos');
                  setStatus('todos');
                  setActivity('todas');
                }
              : undefined
          }
        />
      ) : view === 'cards' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-3.5">
          {visible.map((client) => (
            <ClientCardView
              key={client.id}
              client={client}
              menuOpen={menuId === client.id}
              menuRef={menuRef}
              onOpen={() => openProfile(client)}
              onToggleMenu={() => setMenuId((current) => (current === client.id ? null : client.id))}
              onEdit={() => openEdit(client)}
              onProjects={() => openProfile(client, 'projetos')}
              onSales={() => openProfile(client, 'compras')}
              onToggleStatus={() => toggleStatus(client)}
            />
          ))}
        </div>
      ) : (
        <ClientTable
          clients={visible}
          sortKey={sortKey}
          onSort={setSortKey}
          menuId={menuId}
          menuRef={menuRef}
          onOpen={openProfile}
          onToggleMenu={(id) => setMenuId((current) => (current === id ? null : id))}
          onEdit={openEdit}
          onProjects={(client) => openProfile(client, 'projetos')}
          onSales={(client) => openProfile(client, 'compras')}
          onToggleStatus={toggleStatus}
        />
      )}

      {!loading && filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between text-[12px] text-[#5A6B82]">
          <span>
            {filtered.length} clientes · página {currentPage} de {pageCount}
          </span>
          <div className="flex gap-1">
            <button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => value - 1)} aria-label="Página anterior" className="h-8 w-8 rounded-lg border border-[#E4EAF1] bg-white disabled:opacity-40 inline-flex items-center justify-center">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button type="button" disabled={currentPage === pageCount} onClick={() => setPage((value) => value + 1)} aria-label="Próxima página" className="h-8 w-8 rounded-lg border border-[#E4EAF1] bg-white disabled:opacity-40 inline-flex items-center justify-center">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {profile && (
        <ClientProfile
          client={profile}
          tab={tab}
          onTab={setTab}
          onClose={() => setProfile(null)}
          onEdit={() => openEdit(profile)}
          onToggleStatus={() => toggleStatus(profile)}
        />
      )}

      {editor && (
        <ClientForm
          client={editor}
          creating={creating}
          onChange={setEditor}
          onClose={() => setEditor(null)}
          onSave={saveEditor}
        />
      )}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2.5 min-w-[140px]">
      <Icon className="w-4 h-4 text-[#8A98AB]" strokeWidth={1.75} />
      <div>
        <div className="text-[16px] font-semibold text-[#071A34] leading-none tabular-nums">{value}</div>
        <div className="text-[11.5px] text-[#5A6B82] mt-1">{label}</div>
      </div>
    </div>
  );
}

function ClientCardView({
  client,
  menuOpen,
  menuRef,
  onOpen,
  onToggleMenu,
  onEdit,
  onProjects,
  onSales,
  onToggleStatus,
}: {
  client: ClientCard;
  menuOpen: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  onOpen: () => void;
  onToggleMenu: () => void;
  onEdit: () => void;
  onProjects: () => void;
  onSales: () => void;
  onToggleStatus: () => void;
}) {
  return (
    <article className={`bg-white border border-[#E7EDF3] rounded-2xl p-3.5 flex flex-col ${client.status === 'inativo' ? 'opacity-75' : ''}`}>
      <div className="flex items-start gap-3">
        <button type="button" onClick={onOpen} className="flex items-start gap-3 text-left min-w-0 flex-1">
          <Avatar client={client} />
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold text-[#071A34] truncate">{client.company}</span>
            <span className="block text-[12px] text-[#5A6B82] truncate">{client.kind === 'pj' ? client.name : 'Pessoa física'}</span>
          </span>
        </button>
        <div className="relative">
          <button type="button" data-client-menu aria-expanded={menuOpen} aria-label={`Ações de ${client.company}`} onClick={onToggleMenu} className="h-7 w-7 rounded-full text-[#5A6B82] hover:bg-[#F4F7FB] inline-flex items-center justify-center">
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {menuOpen && (
            <ClientMenu
              menuRef={menuRef}
              inactive={client.status === 'inativo'}
              onOpen={onOpen}
              onEdit={onEdit}
              onProjects={onProjects}
              onSales={onSales}
              onToggleStatus={onToggleStatus}
            />
          )}
        </div>
      </div>
      <button type="button" onClick={onOpen} className="mt-3 space-y-1 text-left">
        <p className="flex items-center gap-1.5 text-[12px] text-[#5A6B82]">
          <Phone className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
          {client.phone}
        </p>
        <p className="flex items-center gap-1.5 text-[12px] text-[#5A6B82]">
          <Mail className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{client.email || 'Sem e-mail'}</span>
        </p>
      </button>
      <div className="mt-3 pt-3 border-t border-[#F1F5F9] flex items-end justify-between gap-2">
        <div className="text-[12px] text-[#5A6B82]">
          <div>{client.activeProjects} projetos · {client.ordersCount} pedidos</div>
          <div className="mt-0.5 text-[#071A34] font-medium tabular-nums">{formatBRL(client.totalSpent)}</div>
          <div className="text-[11px] text-[#8A98AB] mt-0.5">{client.lastActivity}</div>
        </div>
        <StatusText status={client.status} />
      </div>
    </article>
  );
}

function ClientTable({
  clients,
  sortKey,
  onSort,
  menuId,
  menuRef,
  onOpen,
  onToggleMenu,
  onEdit,
  onProjects,
  onSales,
  onToggleStatus,
}: {
  clients: ClientCard[];
  sortKey: SortKey;
  onSort: (key: SortKey) => void;
  menuId: string | null;
  menuRef: RefObject<HTMLDivElement | null>;
  onOpen: (client: ClientCard) => void;
  onToggleMenu: (id: string) => void;
  onEdit: (client: ClientCard) => void;
  onProjects: (client: ClientCard) => void;
  onSales: (client: ClientCard) => void;
  onToggleStatus: (client: ClientCard) => void;
}) {
  const head = (label: string, key?: SortKey, align = 'left') => (
    <th className={`py-2.5 px-3 font-medium ${align === 'right' ? 'text-right' : ''}`}>
      {key ? (
        <button type="button" onClick={() => onSort(key)} className={`inline-flex items-center gap-1 ${sortKey === key ? 'text-[#071A34]' : ''}`}>
          {label}
        </button>
      ) : (
        label
      )}
    </th>
  );
  return (
    <div className="bg-white border border-[#E4EAF1] rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[820px]">
          <thead>
            <tr className="border-b border-[#EEF2F7] bg-[#FAFBFD] text-[11.5px] font-medium text-[#5A6B82]">
              {head('Cliente', 'name')}
              <th className="py-2.5 px-3 font-medium">Contato</th>
              <th className="py-2.5 px-3 font-medium">Tipo</th>
              <th className="py-2.5 px-3 font-medium text-right">Projetos</th>
              {head('Total em compras', 'volume', 'right')}
              {head('Última atividade', 'recent')}
              <th className="py-2.5 px-3 font-medium">Status</th>
              <th className="py-2.5 px-3 w-12"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9] text-[13px]">
            {clients.map((client) => (
              <tr key={client.id} className={`hover:bg-[#F8FAFC] ${client.status === 'inativo' ? 'opacity-70' : ''}`}>
                <td className="py-2.5 px-3">
                  <button type="button" onClick={() => onOpen(client)} className="flex items-center gap-2.5 text-left">
                    <Avatar client={client} small />
                    <span>
                      <span className="block font-medium text-[#071A34]">{client.company}</span>
                      <span className="block text-[11.5px] text-[#5A6B82]">{client.kind === 'pj' ? client.name : 'Pessoa física'}</span>
                    </span>
                  </button>
                </td>
                <td className="py-2.5 px-3 text-[12px] text-[#5A6B82]">
                  <div>{client.phone}</div>
                  <div className="truncate max-w-[180px]">{client.email || '—'}</div>
                </td>
                <td className="py-2.5 px-3 text-[#334155]">{client.kind === 'pj' ? 'Jurídica' : 'Física'}</td>
                <td className="py-2.5 px-3 text-right tabular-nums">{client.activeProjects}</td>
                <td className="py-2.5 px-3 text-right tabular-nums font-medium text-[#071A34]">{formatBRL(client.totalSpent)}</td>
                <td className="py-2.5 px-3 text-[12px] text-[#5A6B82] whitespace-nowrap">{client.lastActivity}</td>
                <td className="py-2.5 px-3"><StatusText status={client.status} /></td>
                <td className="py-2.5 px-3">
                  <button type="button" data-client-menu aria-expanded={menuId === client.id} aria-label={`Ações de ${client.company}`} onClick={() => onToggleMenu(client.id)} className="h-7 w-7 rounded-full text-[#5A6B82] hover:bg-[#F4F7FB] inline-flex items-center justify-center">
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                  {menuId === client.id && (
                    <ClientMenu menuRef={menuRef} inactive={client.status === 'inativo'} onOpen={() => onOpen(client)} onEdit={() => onEdit(client)} onProjects={() => onProjects(client)} onSales={() => onSales(client)} onToggleStatus={() => onToggleStatus(client)} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ClientMenu({
  menuRef,
  inactive,
  onOpen,
  onEdit,
  onProjects,
  onSales,
  onToggleStatus,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  inactive: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onProjects: () => void;
  onSales: () => void;
  onToggleStatus: () => void;
}) {
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    const anchor = document.querySelector('[data-client-menu][aria-expanded="true"]')?.getBoundingClientRect();
    if (!anchor) return;
    const width = 196;
    setPos({
      top: anchor.bottom + 6,
      left: Math.min(Math.max(8, anchor.right - width), window.innerWidth - width - 8),
    });
  }, []);
  const Item = ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button type="button" onClick={onClick} className="mx-1 my-0.5 w-[calc(100%-0.5rem)] px-2.5 py-1.5 rounded-lg text-left text-[12.5px] text-[#334155] hover:bg-[#F4F7FB] hover:text-[#071A34]">
      {label}
    </button>
  );
  return createPortal(
    <div ref={menuRef} style={pos} className="fixed z-40 w-[196px] rounded-xl bg-white py-1 shadow-[0_12px_32px_rgba(7,26,52,0.12)]">
      <Item label="Abrir perfil" onClick={onOpen} />
      <Item label="Editar" onClick={onEdit} />
      <Item label="Ver projetos" onClick={onProjects} />
      <Item label="Ver histórico de compras" onClick={onSales} />
      <Item label={inactive ? 'Reativar' : 'Marcar inativo'} onClick={onToggleStatus} />
    </div>,
    document.body
  );
}

function ClientProfile({
  client,
  tab,
  onTab,
  onClose,
  onEdit,
  onToggleStatus,
}: {
  client: ClientCard;
  tab: ProfileTab;
  onTab: (tab: ProfileTab) => void;
  onClose: () => void;
  onEdit: () => void;
  onToggleStatus: () => void;
}) {
  const projects = PROJECT_THREADS.filter((item) => item.clientId === client.id);
  const files = FILE_ASSETS.filter((item) => item.clientId === client.id);
  const sales = INITIAL_SALES.filter((item) => item.clientId === client.id);
  const tabs: Array<{ id: ProfileTab; label: string }> = [
    { id: 'dados', label: 'Dados' },
    { id: 'projetos', label: 'Projetos' },
    { id: 'arquivos', label: 'Arquivos' },
    { id: 'compras', label: 'Compras' },
    { id: 'observacoes', label: 'Observações' },
  ];
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Fechar perfil" className="absolute inset-0 bg-[#071A34]/20" onClick={onClose} />
      <aside className="relative h-full w-full max-w-[680px] bg-white border-l border-[#E4EAF1] shadow-xl flex flex-col">
        <div className="px-5 py-4 border-b border-[#EEF2F7] flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar client={client} />
            <div className="min-w-0">
              <h3 className="text-[16px] font-semibold text-[#071A34] truncate">{client.company}</h3>
              <p className="text-[12.5px] text-[#5A6B82]">{client.kind === 'pj' ? client.name : 'Pessoa física'} · {client.document}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="h-8 w-8 rounded-lg text-[#5A6B82] hover:bg-[#F4F7FB] inline-flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 pt-3 flex gap-1 overflow-x-auto">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onTab(item.id)}
              className={`h-8 px-3 rounded-lg text-[12.5px] whitespace-nowrap ${tab === item.id ? 'bg-[#071A34] text-white' : 'text-[#5A6B82] hover:bg-[#F4F7FB]'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'dados' && (
            <dl className="grid grid-cols-2 gap-4 text-[12.5px]">
              <Info label="Tipo" value={client.kind === 'pj' ? 'Pessoa jurídica' : 'Pessoa física'} />
              <Info label="Status" value={client.status === 'ativo' ? 'Ativo' : 'Inativo'} />
              <Info label="Telefone" value={client.phone} />
              <Info label="E-mail" value={client.email || '—'} />
              <Info label="Cidade" value={client.city} />
              <Info label="Documento" value={client.document} />
              <Info label="Projetos ativos" value={String(client.activeProjects)} />
              <Info label="Pedidos" value={String(client.ordersCount)} />
              <Info label="Total em compras" value={formatBRL(client.totalSpent)} />
              <Info label="Última atividade" value={client.lastActivity} />
            </dl>
          )}
          {tab === 'projetos' && <SimpleList empty="Nenhum projeto vinculado." items={projects.map((item) => ({ id: item.id, title: item.title, detail: `${item.productRef} · ${item.updatedAt}` }))} />}
          {tab === 'arquivos' && <SimpleList empty="Nenhuma arte ou arquivo." items={files.map((item) => ({ id: item.id, title: item.name, detail: `${item.project} · ${item.size}` }))} />}
          {tab === 'compras' && (
            <div className="space-y-3">
              <p className="text-[12.5px] text-[#5A6B82]">Total registrado {formatBRL(sales.reduce((sum, sale) => sum + sale.total, 0) || client.totalSpent)}</p>
              <SimpleList empty="Nenhuma compra registrada." items={sales.map((item) => ({ id: item.id, title: `${item.code} · ${formatBRL(item.total)}`, detail: `${item.itemsSummary} · ${item.date}` }))} />
            </div>
          )}
          {tab === 'observacoes' && (
            <p className="text-[13px] text-[#334155] leading-relaxed">{client.notes || 'Nenhuma observação cadastrada.'}</p>
          )}
        </div>
        <div className="border-t border-[#EEF2F7] px-5 py-3 flex justify-end gap-2">
          <button type="button" onClick={onToggleStatus} className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px] text-[#334155]">
            {client.status === 'ativo' ? 'Marcar inativo' : 'Reativar'}
          </button>
          <button type="button" onClick={onEdit} className="h-9 px-3.5 rounded-lg bg-[#071A34] text-white text-[12.5px] font-medium inline-flex items-center gap-1.5">
            <Pencil className="w-3.5 h-3.5" />
            Editar
          </button>
        </div>
      </aside>
    </div>
  );
}

function ClientForm({
  client,
  creating,
  onChange,
  onClose,
  onSave,
}: {
  client: ClientCard;
  creating: boolean;
  onChange: (next: ClientCard) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const [tried, setTried] = useState(false);
  const invalid = !client.name.trim();
  const field = 'h-9 w-full rounded-lg border border-[#E4EAF1] bg-white px-3 text-[12.5px] text-[#0F1E36] outline-none focus:border-[#C5D0DE]';
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Fechar cadastro" className="absolute inset-0 bg-[#071A34]/20" onClick={onClose} />
      <aside className="relative h-full w-full max-w-md bg-white border-l border-[#E4EAF1] shadow-xl flex flex-col">
        <div className="px-5 py-3.5 border-b border-[#EEF2F7] flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-[#071A34]">{creating ? 'Novo cliente' : 'Editar cliente'}</h3>
          <button type="button" onClick={onClose} aria-label="Fechar" className="h-8 w-8 rounded-lg text-[#5A6B82] hover:bg-[#F4F7FB] inline-flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <FormSection title="Dados principais">
            <Label text="Nome">
              <input value={client.name} onChange={(event) => onChange({ ...client, name: event.target.value })} className={field} />
              {tried && invalid && <span className="text-[11.5px] text-rose-700">Informe o nome.</span>}
            </Label>
            <Label text="Tipo">
              <SelectMenu
                value={client.kind}
                ariaLabel="Tipo de cliente"
                className="w-full max-w-none"
                onChange={(value) => onChange({ ...client, kind: value })}
                options={[
                  { value: 'pj', label: 'Pessoa jurídica' },
                  { value: 'pf', label: 'Pessoa física' },
                ]}
              />
            </Label>
            {client.kind === 'pj' && (
              <Label text="Empresa">
                <input value={client.company} onChange={(event) => onChange({ ...client, company: event.target.value })} className={field} />
              </Label>
            )}
            <Label text="Documento">
              <input value={client.document} onChange={(event) => onChange({ ...client, document: event.target.value })} className={field} />
            </Label>
          </FormSection>
          <FormSection title="Contatos">
            <Label text="Telefone">
              <input value={client.phone} onChange={(event) => onChange({ ...client, phone: event.target.value })} className={field} />
            </Label>
            <Label text="E-mail">
              <input value={client.email} onChange={(event) => onChange({ ...client, email: event.target.value })} className={field} />
            </Label>
            <Label text="Cidade">
              <input value={client.city} onChange={(event) => onChange({ ...client, city: event.target.value })} className={field} />
            </Label>
          </FormSection>
          <FormSection title="Dados complementares">
            <Label text="Status">
              <SelectMenu
                value={client.status}
                ariaLabel="Status do cliente"
                className="w-full max-w-none"
                onChange={(value) => onChange({ ...client, status: value })}
                options={[
                  { value: 'ativo', label: 'Ativo' },
                  { value: 'inativo', label: 'Inativo' },
                ]}
              />
            </Label>
          </FormSection>
          <FormSection title="Observações">
            <textarea value={client.notes} onChange={(event) => onChange({ ...client, notes: event.target.value })} rows={3} className="w-full rounded-lg border border-[#E4EAF1] px-3 py-2 text-[12.5px] outline-none focus:border-[#C5D0DE] resize-none" />
          </FormSection>
        </div>
        <div className="border-t border-[#EEF2F7] px-5 py-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px]">Cancelar</button>
          <button
            type="button"
            onClick={() => {
              if (invalid) {
                setTried(true);
                return;
              }
              onSave();
            }}
            className="h-9 px-3.5 rounded-lg bg-[#071A34] text-white text-[12.5px] font-medium"
          >
            Salvar cliente
          </button>
        </div>
      </aside>
    </div>
  );
}

function Avatar({ client, small }: { client: ClientCard; small?: boolean }) {
  return (
    <span
      className={`${small ? 'w-8 h-8 text-[11px]' : 'w-10 h-10 text-[12px]'} rounded-full text-white font-semibold inline-flex items-center justify-center shrink-0`}
      style={{ backgroundColor: client.accentColor }}
    >
      {client.initials}
    </span>
  );
}

function StatusText({ status }: { status: ClientStatus }) {
  const active = status === 'ativo';
  return (
    <span className={`inline-flex h-6 items-center gap-1.5 px-2 rounded-full text-[11px] font-medium ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-[#F3F6FA] text-[#5A6B82]'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-[#8A98AB]'}`} />
      {active ? 'Ativo' : 'Inativo'}
    </span>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h4 className="text-[12px] font-semibold uppercase tracking-[0.05em] text-[#5A6B82]">{title}</h4>
      {children}
    </section>
  );
}

function Label({ text, children }: { text: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11.5px] text-[#5A6B82]">{text}</span>
      {children}
    </label>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-[#8A98AB]">{label}</dt>
      <dd className="text-[#0F1E36] mt-0.5">{value}</dd>
    </div>
  );
}

function SimpleList({ items, empty }: { items: Array<{ id: string; title: string; detail: string }>; empty: string }) {
  if (items.length === 0) return <p className="text-[12.5px] text-[#8A98AB]">{empty}</p>;
  return (
    <div className="divide-y divide-[#F1F5F9]">
      {items.map((item) => (
        <div key={item.id} className="py-2.5">
          <div className="text-[13px] text-[#071A34]">{item.title}</div>
          <div className="text-[12px] text-[#5A6B82]">{item.detail}</div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  title,
  text,
  actionLabel,
  onAction,
}: {
  title: string;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="py-16 flex flex-col items-center text-center">
      <div className="h-11 w-11 rounded-full bg-white border border-[#E4EAF1] text-[#8A98AB] inline-flex items-center justify-center">
        <Users className="w-5 h-5" />
      </div>
      <h3 className="mt-3 text-[14px] font-semibold text-[#071A34]">{title}</h3>
      <p className="mt-1 text-[12.5px] text-[#5A6B82] max-w-sm">{text}</p>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="mt-4 h-9 px-3.5 rounded-lg bg-[#071A34] text-white text-[12.5px] font-medium">
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function blankClient(): ClientCard {
  return {
    id: `cli-${Date.now()}`,
    name: '',
    company: '',
    initials: 'NC',
    accentColor: '#1E3A5F',
    email: '',
    phone: '',
    document: '',
    city: '',
    totalSpent: 0,
    ordersCount: 0,
    activeProjects: 0,
    lastActivity: 'Agora',
    kind: 'pj',
    status: 'ativo',
    createdAt: new Date().toISOString().slice(0, 10),
    notes: '',
  };
}

function initialsOf(value: string): string {
  const parts = value.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || 'NC';
}

function compareClients(a: ClientCard, b: ClientCard, sortKey: SortKey): number {
  if (sortKey === 'created') return b.createdAt.localeCompare(a.createdAt);
  if (sortKey === 'volume') return b.totalSpent - a.totalSpent;
  if (sortKey === 'recent') return activityRank(a.lastActivity) - activityRank(b.lastActivity);
  return a.company.localeCompare(b.company, 'pt-BR');
}

function activityRank(label: string): number {
  if (/hoje/i.test(label)) return 0;
  if (/ontem/i.test(label)) return 1;
  return 2;
}
