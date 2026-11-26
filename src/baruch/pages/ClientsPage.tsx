import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileImage,
  FileText,
  FolderOpen,
  LayoutGrid,
  List,
  Mail,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  PenTool,
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
  blankClient,
  clientErrorMessage,
  deleteClient,
  loadActivities,
  loadClients,
  saveClient,
  subscribeClients,
} from '../clients/clientStore';
import type { ClientActivity, ClientFieldErrors, ClientKind, ClientLifecycle, ClientProfile } from '../clients/clientTypes';
import { displayName, hasClientErrors, validateClient } from '../clients/clientValidation';
import { FILE_ASSETS, PROJECT_THREADS, formatBRL } from '../data/mockData';
import { readCatalogImage } from '../products/catalogImages';
import type { NavPageId, SaleRecord } from '../types';

interface ClientsPageProps {
  globalSearch: string;
  onBreadcrumbChange: (crumb: string | null) => void;
  onNavigate: (page: NavPageId) => void;
  sales: SaleRecord[];
  onOpenChat: (clientId: string) => void;
}

type ViewMode = 'cards' | 'list';
type SortKey = 'name' | 'newest' | 'oldest' | 'activity' | 'volume_desc' | 'volume_asc';
type KindFilter = 'todos' | ClientKind;
type StatusFilter = 'todos' | ClientLifecycle;
type ActivityFilter = 'todas' | 'recentes' | 'compras' | 'sem';
type ProfileTab = 'dados' | 'projetos' | 'arquivos' | 'compras' | 'observacoes';

interface ClientFacts {
  total: number;
  orders: number;
  projectCount: number;
  lastPurchase: string;
  lastActivity: string;
  lastActivityAt: string;
  recent: boolean;
}

const PAGE_SIZE = 8;
const MONTH = 1000 * 60 * 60 * 24 * 30;

export function ClientsPage({
  globalSearch,
  onBreadcrumbChange,
  sales,
  onOpenChat,
}: ClientsPageProps) {
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [activities, setActivities] = useState<ClientActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('todos');
  const [status, setStatus] = useState<StatusFilter>('todos');
  const [activity, setActivity] = useState<ActivityFilter>('todas');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [view, setView] = useState<ViewMode>('cards');
  const [page, setPage] = useState(1);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [tab, setTab] = useState<ProfileTab>('dados');
  const [editor, setEditor] = useState<ClientProfile | null>(null);
  const [creating, setCreating] = useState(false);
  const [errors, setErrors] = useState<ClientFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ClientProfile | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const refresh = async () => {
    const [items, activityItems] = await Promise.all([loadClients(), loadActivities()]);
    setClients(items);
    setActivities(activityItems);
  };

  useEffect(() => {
    let alive = true;
    const run = () => {
      refresh()
        .catch((error: unknown) => {
          if (alive) setLoadError(clientErrorMessage(error));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    };
    run();
    const unsubscribe = subscribeClients(() => {
      if (alive) void refresh().catch(() => undefined);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const facts = useMemo(() => {
    const map = new Map<string, ClientFacts>();
    clients.forEach((client) => map.set(client.id, buildFacts(client, sales, activities)));
    return map;
  }, [clients, sales, activities]);

  const profile = clients.find((client) => client.id === profileId) ?? null;

  useEffect(() => {
    onBreadcrumbChange(profile ? displayName(profile) : null);
    return () => onBreadcrumbChange(null);
  }, [profile, onBreadcrumbChange]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3600);
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
      const info = facts.get(client.id);
      if (activity === 'recentes' && !info?.recent) return false;
      if (activity === 'compras' && (info?.orders ?? 0) === 0) return false;
      if (activity === 'sem' && (info?.orders ?? 0) > 0) return false;
      const hay = `${client.name} ${client.company} ${client.document} ${client.phone} ${client.whatsapp} ${client.email}`.toLowerCase();
      if (local && !hay.includes(local)) return false;
      if (global && !hay.includes(global)) return false;
      return true;
    });
    list.sort((a, b) => compareClients(a, b, sortKey, facts));
    return list;
  }, [clients, query, globalSearch, kind, status, activity, sortKey, facts]);

  useEffect(() => {
    setPage(1);
  }, [query, globalSearch, kind, status, activity, sortKey, view]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const filtersActive = query.trim().length > 0 || kind !== 'todos' || status !== 'todos' || activity !== 'todas';
  const activeCount = clients.filter((client) => client.status === 'ativo').length;
  const recentCount = clients.filter((client) => facts.get(client.id)?.recent).length;
  const buyerCount = clients.filter((client) => (facts.get(client.id)?.orders ?? 0) > 0).length;

  const openProfile = (client: ClientProfile, nextTab: ProfileTab = 'dados') => {
    setProfileId(client.id);
    setTab(nextTab);
    setMenuId(null);
  };

  const saveEditor = async () => {
    if (!editor) return;
    const nextErrors = validateClient(editor, clients);
    setErrors(nextErrors);
    if (hasClientErrors(nextErrors)) {
      setNotice({ tone: 'err', text: nextErrors.name || nextErrors.company || nextErrors.document || nextErrors.email || 'Revise o cadastro.' });
      return;
    }
    setSaving(true);
    try {
      await saveClient(editor);
      setEditor(null);
      setNotice({ tone: 'ok', text: creating ? 'Cliente cadastrado.' : 'Dados do cliente atualizados.' });
    } catch (error) {
      setNotice({ tone: 'err', text: clientErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const archive = async (client: ClientProfile) => {
    try {
      const nextStatus: ClientLifecycle = client.status === 'arquivado' ? 'ativo' : 'arquivado';
      await saveClient({ ...client, status: nextStatus });
      setMenuId(null);
      setNotice({ tone: 'ok', text: nextStatus === 'arquivado' ? 'Cliente arquivado.' : 'Cliente reativado.' });
    } catch (error) {
      setNotice({ tone: 'err', text: clientErrorMessage(error) });
    }
  };

  const askDelete = (client: ClientProfile) => {
    const info = facts.get(client.id);
    const linkedFiles = FILE_ASSETS.some((file) => file.clientId === client.id);
    const linkedProjects = PROJECT_THREADS.some((project) => project.clientId === client.id);
    if ((info?.orders ?? 0) > 0 || linkedFiles || linkedProjects) {
      setNotice({
        tone: 'err',
        text: 'Este cliente tem vendas, projetos ou arquivos. Arquive-o para manter o histórico.',
      });
      setMenuId(null);
      return;
    }
    setPendingDelete(client);
    setMenuId(null);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteClient(pendingDelete.id);
      if (profileId === pendingDelete.id) setProfileId(null);
      setNotice({ tone: 'ok', text: 'Cliente excluído.' });
    } catch (error) {
      setNotice({ tone: 'err', text: clientErrorMessage(error) });
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-[#071A34] tracking-[-0.015em]">Clientes</h2>
          <p className="text-[12.5px] text-[#5A6B82] mt-0.5">Gerencie clientes, dados, histórico e projetos.</p>
        </div>
        <button type="button" onClick={() => { setCreating(true); setErrors({}); setEditor(blankClient()); }} className="h-9 px-3.5 rounded-lg bg-[#071A34] text-white text-[12.5px] font-medium hover:bg-[#0D284D] inline-flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5 text-[#E3C16F]" />
          Novo cliente
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-7 gap-y-2">
        <Stat icon={Users} label="Total de clientes" value={String(clients.length)} />
        <Stat icon={UserRound} label="Clientes ativos" value={String(activeCount)} />
        <Stat icon={FolderOpen} label="Clientes recentes" value={String(recentCount)} />
        <Stat icon={ShoppingBag} label="Clientes com compras" value={String(buyerCount)} />
      </div>

      {notice && (
        <div role="status" className={`rounded-lg px-3 py-2 text-[12.5px] ${notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
          {notice.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-[#8A98AB] absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, documento, telefone ou e-mail" aria-label="Buscar cliente" className="h-9 w-full rounded-lg border border-[#E4EAF1] bg-white pl-8 pr-3 text-[12.5px] outline-none focus:border-[#C5D0DE]" />
        </label>
        <SelectMenu value={kind} ariaLabel="Filtrar por tipo" onChange={setKind} options={[{ value: 'todos', label: 'Todos os tipos' }, { value: 'pj', label: 'Pessoa jurídica' }, { value: 'pf', label: 'Pessoa física' }]} />
        <SelectMenu value={status} ariaLabel="Filtrar por status" onChange={setStatus} options={[{ value: 'todos', label: 'Todos os status' }, { value: 'ativo', label: 'Ativos' }, { value: 'arquivado', label: 'Arquivados' }]} />
        <SelectMenu value={activity} ariaLabel="Filtrar por atividade" onChange={setActivity} options={[{ value: 'todas', label: 'Toda a atividade' }, { value: 'recentes', label: 'Recentes' }, { value: 'compras', label: 'Com compras' }, { value: 'sem', label: 'Sem compras' }]} />
        <div className="ml-auto flex items-center gap-1.5">
          <SelectMenu value={sortKey} ariaLabel="Ordenar clientes" onChange={setSortKey} options={[{ value: 'name', label: 'Nome' }, { value: 'newest', label: 'Cadastro mais recente' }, { value: 'oldest', label: 'Cadastro mais antigo' }, { value: 'activity', label: 'Última atividade' }, { value: 'volume_desc', label: 'Maior volume' }, { value: 'volume_asc', label: 'Menor volume' }]} />
          <div className="inline-flex h-8 items-center rounded-lg bg-[#EEF2F6] p-0.5">
            <button type="button" aria-label="Visualizar em cards" aria-pressed={view === 'cards'} onClick={() => setView('cards')} className={`h-7 w-7 rounded-md inline-flex items-center justify-center ${view === 'cards' ? 'bg-white text-[#071A34] shadow-[0_1px_2px_rgba(7,26,52,0.08)]' : 'text-[#8A98AB]'}`}><LayoutGrid className="w-3.5 h-3.5" /></button>
            <button type="button" aria-label="Visualizar em lista" aria-pressed={view === 'list'} onClick={() => setView('list')} className={`h-7 w-7 rounded-md inline-flex items-center justify-center ${view === 'list' ? 'bg-white text-[#071A34] shadow-[0_1px_2px_rgba(7,26,52,0.08)]' : 'text-[#8A98AB]'}`}><List className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-44 rounded-2xl bg-white border border-[#E7EDF3] animate-pulse" />)}</div>
      ) : loadError ? (
        <EmptyState title="Não foi possível carregar os clientes" text={loadError} actionLabel="Tentar de novo" onAction={() => { setLoadError(''); setLoading(true); void refresh().finally(() => setLoading(false)); }} />
      ) : clients.length === 0 ? (
        <EmptyState title="Nenhum cliente cadastrado" text="Cadastre o primeiro cliente para acompanhar contatos, projetos e compras." actionLabel="Novo cliente" onAction={() => { setCreating(true); setEditor(blankClient()); }} />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nenhum cliente encontrado" text={query.trim() ? `Não há resultados para “${query.trim()}”.` : 'Ajuste os filtros para ver outros clientes.'} actionLabel={filtersActive ? 'Limpar filtros' : undefined} onAction={filtersActive ? () => { setQuery(''); setKind('todos'); setStatus('todos'); setActivity('todas'); } : undefined} />
      ) : view === 'cards' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-3.5">
          {visible.map((client) => (
            <ClientCardView key={client.id} client={client} info={facts.get(client.id)} menuOpen={menuId === client.id} menuRef={menuRef} onOpen={() => openProfile(client)} onToggleMenu={() => setMenuId((current) => (current === client.id ? null : client.id))} onEdit={() => { setCreating(false); setErrors({}); setEditor(client); }} onProjects={() => openProfile(client, 'projetos')} onFiles={() => openProfile(client, 'arquivos')} onSales={() => openProfile(client, 'compras')} onChat={() => onOpenChat(client.id)} onArchive={() => void archive(client)} onDelete={() => askDelete(client)} />
          ))}
        </div>
      ) : (
        <ClientTable clients={visible} facts={facts} sortKey={sortKey} onSort={setSortKey} menuId={menuId} menuRef={menuRef} onOpen={openProfile} onToggleMenu={(id) => setMenuId((current) => (current === id ? null : id))} onEdit={(client) => { setCreating(false); setErrors({}); setEditor(client); }} onProjects={(client) => openProfile(client, 'projetos')} onFiles={(client) => openProfile(client, 'arquivos')} onSales={(client) => openProfile(client, 'compras')} onChat={onOpenChat} onArchive={(client) => void archive(client)} onDelete={askDelete} />
      )}

      {!loading && filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between text-[12px] text-[#5A6B82]">
          <span>{filtered.length} clientes · página {currentPage} de {pageCount}</span>
          <div className="flex gap-1">
            <button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => value - 1)} aria-label="Página anterior" className="h-8 w-8 rounded-lg border border-[#E4EAF1] bg-white disabled:opacity-40 inline-flex items-center justify-center"><ChevronLeft className="w-4 h-4" /></button>
            <button type="button" disabled={currentPage === pageCount} onClick={() => setPage((value) => value + 1)} aria-label="Próxima página" className="h-8 w-8 rounded-lg border border-[#E4EAF1] bg-white disabled:opacity-40 inline-flex items-center justify-center"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {profile && (
        <ClientProfile client={profile} info={facts.get(profile.id)} sales={sales.filter((sale) => sale.clientId === profile.id)} activity={activities.find((item) => item.clientId === profile.id)} tab={tab} onTab={setTab} onClose={() => setProfileId(null)} onEdit={() => { setCreating(false); setErrors({}); setEditor(profile); }} onArchive={() => void archive(profile)} onChat={() => onOpenChat(profile.id)} onSaveNotes={(notes) => void saveClient({ ...profile, notes })} />
      )}
      {editor && (
        <ClientForm client={editor} creating={creating} errors={errors} saving={saving} onChange={setEditor} onClose={() => setEditor(null)} onSave={() => void saveEditor()} />
      )}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-[#071A34]/25" aria-label="Cancelar exclusão" onClick={() => setPendingDelete(null)} />
          <div className="relative w-full max-w-sm bg-white border border-[#E4EAF1] rounded-lg p-5">
            <h3 className="text-[15px] font-semibold text-[#071A34]">Excluir cliente</h3>
            <p className="mt-1.5 text-[12.5px] text-[#5A6B82]">{displayName(pendingDelete)} não tem vendas nem arquivos vinculados.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setPendingDelete(null)} className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px]">Cancelar</button>
              <button type="button" onClick={() => void confirmDelete()} className="h-9 px-3 rounded-lg bg-[#071A34] text-white text-[12.5px]">Excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ClientCardView(props: {
  client: ClientProfile;
  info?: ClientFacts;
  menuOpen: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  onOpen: () => void;
  onToggleMenu: () => void;
  onEdit: () => void;
  onProjects: () => void;
  onFiles: () => void;
  onSales: () => void;
  onChat: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const { client, info } = props;
  return (
    <article className={`bg-white border border-[#E7EDF3] rounded-2xl p-3.5 flex flex-col ${client.status === 'arquivado' ? 'opacity-75' : ''}`}>
      <div className="flex items-start gap-3">
        <button type="button" onClick={props.onOpen} className="flex items-start gap-3 text-left min-w-0 flex-1">
          <Avatar client={client} />
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold text-[#071A34] truncate">{displayName(client)}</span>
            <span className="block text-[12px] text-[#5A6B82] truncate">{client.kind === 'pj' ? client.name || 'Pessoa jurídica' : 'Pessoa física'}</span>
          </span>
        </button>
        <MenuButton {...props} />
      </div>
      <button type="button" onClick={props.onOpen} className="mt-3 space-y-1 text-left">
        <p className="flex items-center gap-1.5 text-[12px] text-[#5A6B82]"><Phone className="w-3.5 h-3.5 shrink-0" />{client.phone || 'Sem telefone'}</p>
        <p className="flex items-center gap-1.5 text-[12px] text-[#5A6B82]"><Mail className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{client.email || 'Sem e-mail'}</span></p>
      </button>
      <div className="mt-3 pt-3 border-t border-[#F1F5F9] flex items-end justify-between gap-2">
        <div className="text-[12px] text-[#5A6B82]">
          <div>{info?.projectCount ?? 0} projetos · {info?.orders ?? 0} pedidos</div>
          <div className="mt-0.5 text-[#071A34] font-medium tabular-nums">{formatBRL(info?.total ?? 0)}</div>
          <div className="text-[11px] text-[#8A98AB] mt-0.5">{info?.lastActivity}</div>
        </div>
        <StatusText status={client.status} />
      </div>
    </article>
  );
}

function ClientTable(props: {
  clients: ClientProfile[];
  facts: Map<string, ClientFacts>;
  sortKey: SortKey;
  onSort: (key: SortKey) => void;
  menuId: string | null;
  menuRef: RefObject<HTMLDivElement | null>;
  onOpen: (client: ClientProfile, tab?: ProfileTab) => void;
  onToggleMenu: (id: string) => void;
  onEdit: (client: ClientProfile) => void;
  onProjects: (client: ClientProfile) => void;
  onFiles: (client: ClientProfile) => void;
  onSales: (client: ClientProfile) => void;
  onChat: (clientId: string) => void;
  onArchive: (client: ClientProfile) => void;
  onDelete: (client: ClientProfile) => void;
}) {
  return (
    <div className="bg-white border border-[#E4EAF1] rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left border-collapse">
          <thead>
            <tr className="border-b border-[#EEF2F7] bg-[#FAFBFD] text-[11.5px] font-medium text-[#5A6B82]">
              <SortHead label="Cliente" active={props.sortKey === 'name'} onClick={() => props.onSort('name')} />
              <th className="py-2.5 px-3">Contato</th>
              <th className="py-2.5 px-3">Tipo</th>
              <th className="py-2.5 px-3 text-right">Projetos</th>
              <SortHead label="Total em compras" align="right" active={props.sortKey.startsWith('volume')} onClick={() => props.onSort('volume_desc')} />
              <SortHead label="Última atividade" active={props.sortKey === 'activity'} onClick={() => props.onSort('activity')} />
              <th className="py-2.5 px-3">Status</th>
              <th className="py-2.5 px-3 w-12"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9] text-[13px]">
            {props.clients.map((client) => {
              const info = props.facts.get(client.id);
              return (
                <tr key={client.id} className={client.status === 'arquivado' ? 'opacity-70' : ''}>
                  <td className="py-2.5 px-3">
                    <button type="button" onClick={() => props.onOpen(client)} className="flex items-center gap-2.5 text-left">
                      <Avatar client={client} small />
                      <span>
                        <span className="block font-medium text-[#071A34]">{displayName(client)}</span>
                        <span className="block text-[11.5px] text-[#5A6B82]">{client.kind === 'pj' ? client.name || 'Pessoa jurídica' : 'Pessoa física'}</span>
                      </span>
                    </button>
                  </td>
                  <td className="py-2.5 px-3 text-[12px] text-[#5A6B82]"><div>{client.phone || '—'}</div><div className="truncate max-w-[180px]">{client.email || '—'}</div></td>
                  <td className="py-2.5 px-3">{client.kind === 'pj' ? 'Jurídica' : 'Física'}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{info?.projectCount ?? 0}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-medium">{formatBRL(info?.total ?? 0)}</td>
                  <td className="py-2.5 px-3 text-[12px] text-[#5A6B82] whitespace-nowrap">{info?.lastActivity}</td>
                  <td className="py-2.5 px-3"><StatusText status={client.status} /></td>
                  <td className="py-2.5 px-3">
                    <MenuButton client={client} menuOpen={props.menuId === client.id} menuRef={props.menuRef} onOpen={() => props.onOpen(client)} onToggleMenu={() => props.onToggleMenu(client.id)} onEdit={() => props.onEdit(client)} onProjects={() => props.onProjects(client)} onFiles={() => props.onFiles(client)} onSales={() => props.onSales(client)} onChat={() => props.onChat(client.id)} onArchive={() => props.onArchive(client)} onDelete={() => props.onDelete(client)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MenuButton(props: {
  client: ClientProfile;
  menuOpen: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  onOpen: () => void;
  onToggleMenu: () => void;
  onEdit: () => void;
  onProjects: () => void;
  onFiles: () => void;
  onSales: () => void;
  onChat: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="relative">
      <button type="button" data-client-menu aria-expanded={props.menuOpen} aria-label={`Ações de ${displayName(props.client)}`} onClick={props.onToggleMenu} className="h-7 w-7 rounded-full text-[#5A6B82] hover:bg-[#F4F7FB] inline-flex items-center justify-center">
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {props.menuOpen && (
        <ClientMenu menuRef={props.menuRef} archived={props.client.status === 'arquivado'} onOpen={props.onOpen} onEdit={props.onEdit} onProjects={props.onProjects} onFiles={props.onFiles} onSales={props.onSales} onChat={props.onChat} onArchive={props.onArchive} onDelete={props.onDelete} />
      )}
    </div>
  );
}

function ClientMenu(props: {
  menuRef: RefObject<HTMLDivElement | null>;
  archived: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onProjects: () => void;
  onFiles: () => void;
  onSales: () => void;
  onChat: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    const anchor = document.querySelector('[data-client-menu][aria-expanded="true"]')?.getBoundingClientRect();
    if (!anchor) return;
    setPos({ top: anchor.bottom + 6, left: Math.min(Math.max(8, anchor.right - 210), window.innerWidth - 218) });
  }, []);
  const Item = ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button type="button" onClick={onClick} className="mx-1 my-0.5 w-[calc(100%-0.5rem)] px-2.5 py-1.5 rounded-lg text-left text-[12.5px] text-[#334155] hover:bg-[#F4F7FB] hover:text-[#071A34]">{label}</button>
  );
  return createPortal(
    <div ref={props.menuRef} style={pos} className="fixed z-40 w-[210px] rounded-xl bg-white py-1 shadow-[0_12px_32px_rgba(7,26,52,0.12)]">
      <Item label="Abrir perfil" onClick={props.onOpen} />
      <Item label="Editar cliente" onClick={props.onEdit} />
      <Item label="Nova conversa no Chat" onClick={props.onChat} />
      <Item label="Abrir projetos" onClick={props.onProjects} />
      <Item label="Ver artes e arquivos" onClick={props.onFiles} />
      <Item label="Ver histórico de compras" onClick={props.onSales} />
      <Item label={props.archived ? 'Reativar' : 'Arquivar'} onClick={props.onArchive} />
      <Item label="Excluir" onClick={props.onDelete} />
    </div>,
    document.body
  );
}

function ClientProfile(props: {
  client: ClientProfile;
  info?: ClientFacts;
  sales: SaleRecord[];
  activity?: ClientActivity;
  tab: ProfileTab;
  onTab: (tab: ProfileTab) => void;
  onClose: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onChat: () => void;
  onSaveNotes: (notes: string) => void;
}) {
  const { client, info } = props;
  const projects = PROJECT_THREADS.filter((item) => item.clientId === client.id);
  const files = FILE_ASSETS.filter((item) => item.clientId === client.id);
  const chatArts = (props.activity?.arts ?? []).filter((art) => !files.some((file) => file.name === art.name));
  const [notes, setNotes] = useState(client.notes);
  useEffect(() => setNotes(client.notes), [client.notes, client.id]);
  const tabs: Array<{ id: ProfileTab; label: string }> = [
    { id: 'dados', label: 'Dados' },
    { id: 'projetos', label: 'Projetos' },
    { id: 'arquivos', label: 'Arquivos' },
    { id: 'compras', label: 'Compras' },
    { id: 'observacoes', label: 'Observações' },
  ];
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Fechar perfil" className="absolute inset-0 bg-[#071A34]/20" onClick={props.onClose} />
      <aside className="relative h-full w-full max-w-[680px] bg-white border-l border-[#E4EAF1] shadow-xl flex flex-col">
        <div className="px-5 py-4 border-b border-[#EEF2F7] flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar client={client} />
            <div className="min-w-0">
              <h3 className="text-[16px] font-semibold text-[#071A34] truncate">{displayName(client)}</h3>
              <p className="text-[12.5px] text-[#5A6B82]">{client.kind === 'pj' ? 'Pessoa jurídica' : 'Pessoa física'}{client.document ? ` · ${client.document}` : ''}</p>
            </div>
          </div>
          <button type="button" onClick={props.onClose} aria-label="Fechar" className="h-8 w-8 rounded-lg text-[#5A6B82] hover:bg-[#F4F7FB] inline-flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 pt-3 flex gap-1 overflow-x-auto">
          {tabs.map((item) => (
            <button key={item.id} type="button" onClick={() => props.onTab(item.id)} className={`h-8 px-3 rounded-lg text-[12.5px] whitespace-nowrap ${props.tab === item.id ? 'bg-[#071A34] text-white' : 'text-[#5A6B82] hover:bg-[#F4F7FB]'}`}>{item.label}</button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 text-[12.5px]">
          {props.tab === 'dados' && (
            <dl className="grid grid-cols-2 gap-4">
              <Info label="Telefone" value={client.phone || '—'} />
              <Info label="WhatsApp" value={client.whatsapp || client.phone || '—'} />
              <Info label="E-mail" value={client.email || '—'} />
              <Info label="Cidade" value={client.city || '—'} />
              <Info label="Endereço" value={client.address || '—'} />
              <Info label="Cadastro" value={formatDate(client.createdAt)} />
              <Info label="Total de compras" value={formatBRL(info?.total ?? 0)} />
              <Info label="Pedidos" value={String(info?.orders ?? 0)} />
              <Info label="Última compra" value={info?.lastPurchase || '—'} />
              <Info label="Última atividade" value={info?.lastActivity || '—'} />
              <Info label="Projetos" value={String(info?.projectCount ?? 0)} />
              {client.extra && <Info label="Complemento" value={client.extra} />}
            </dl>
          )}
          {props.tab === 'projetos' && (
            <div className="space-y-2">
              <button type="button" onClick={props.onChat} className="h-8 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px] inline-flex items-center gap-1.5"><MessageSquareText className="w-3.5 h-3.5" />Abrir conversa no Chat</button>
              <SimpleList empty="Nenhum projeto vinculado." items={[
                ...projects.map((item) => ({ id: item.id, title: item.title, detail: `${item.productRef} · ${item.updatedAt}` })),
                ...(props.activity ? [{ id: props.activity.conversationId, title: 'Conversa no Chat', detail: props.activity.preview || 'Sem mensagens recentes' }] : []),
              ]} />
            </div>
          )}
          {props.tab === 'arquivos' && (
            <FileGrid
              files={[
                ...files.map((item) => ({
                  id: item.id,
                  name: item.name,
                  format: item.format,
                  detail: `${item.project} · ${item.size}`,
                })),
                ...chatArts.map((item) => ({
                  id: item.id,
                  name: item.name,
                  format: item.format,
                  detail: 'Arte da conversa',
                  previewUrl: item.previewUrl,
                })),
              ]}
              onOpenChat={props.onChat}
            />
          )}
          {props.tab === 'compras' && (
            <div className="space-y-4">
              <p className="text-[12.5px] text-[#5A6B82]">
                Total registrado <span className="font-semibold text-[#071A34] tabular-nums">{formatBRL(info?.total ?? 0)}</span>
              </p>
              {props.sales.length === 0 ? (
                <p className="text-[#8A98AB]">Nenhuma compra vinculada.</p>
              ) : (
                <div className="space-y-3">
                  {props.sales.map((sale) => (
                    <article key={sale.id} className="rounded-xl border border-[#E7EDF3] px-3.5 py-3">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-[13.5px] font-semibold text-[#071A34]">{sale.code}</div>
                          <div className="mt-0.5 text-[12px] text-[#5A6B82]">{sale.date}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[14px] font-semibold text-[#071A34] tabular-nums">{formatBRL(sale.total)}</div>
                          <div className={`mt-1 inline-flex h-5 items-center px-2 rounded-full text-[11px] font-medium ${sale.status === 'confirmada' ? 'bg-emerald-50 text-emerald-700' : sale.status === 'cancelada' ? 'bg-[#F3F6FA] text-[#5A6B82]' : 'bg-amber-50 text-amber-800'}`}>
                            {sale.status === 'confirmada' ? 'Confirmada' : sale.status === 'cancelada' ? 'Cancelada' : 'Pendente'}
                          </div>
                        </div>
                      </div>
                      <p className="mt-3 text-[13px] text-[#334155] leading-relaxed">{sale.itemsSummary}</p>
                      <p className="mt-2 text-[12px] text-[#8A98AB]">Pagamento · {sale.paymentMethod}</p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
          {props.tab === 'observacoes' && (
            <div className="space-y-2">
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={5} className="w-full rounded-lg border border-[#E4EAF1] px-3 py-2 outline-none focus:border-[#C5D0DE] resize-none" />
              <button type="button" onClick={() => props.onSaveNotes(notes)} className="h-8 px-3 rounded-lg bg-[#071A34] text-white text-[12.5px]">Salvar observações</button>
            </div>
          )}
        </div>
        <div className="border-t border-[#EEF2F7] px-5 py-3 flex justify-end gap-2">
          <button type="button" onClick={props.onArchive} className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px]">{client.status === 'arquivado' ? 'Reativar' : 'Arquivar'}</button>
          <button type="button" onClick={props.onEdit} className="h-9 px-3.5 rounded-lg bg-[#071A34] text-white text-[12.5px] font-medium inline-flex items-center gap-1.5"><Pencil className="w-3.5 h-3.5" />Editar</button>
        </div>
      </aside>
    </div>
  );
}

function ClientForm(props: {
  client: ClientProfile;
  creating: boolean;
  errors: ClientFieldErrors;
  saving: boolean;
  onChange: (next: ClientProfile) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const { client, errors, onChange } = props;
  const field = 'h-9 w-full rounded-lg border border-[#E4EAF1] px-3 text-[12.5px] outline-none focus:border-[#C5D0DE]';
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Fechar cadastro" className="absolute inset-0 bg-[#071A34]/20" onClick={props.onClose} />
      <aside className="relative h-full w-full max-w-md bg-white border-l border-[#E4EAF1] shadow-xl flex flex-col">
        <div className="px-5 py-3.5 border-b border-[#EEF2F7] flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-[#071A34]">{props.creating ? 'Novo cliente' : 'Editar cliente'}</h3>
          <button type="button" onClick={props.onClose} aria-label="Fechar" className="h-8 w-8 rounded-lg text-[#5A6B82] inline-flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <FormSection title="Dados principais">
            <Label text="Tipo">
              <SelectMenu value={client.kind} ariaLabel="Tipo de cliente" className="w-full max-w-none" onChange={(kind) => onChange({ ...client, kind })} options={[{ value: 'pj', label: 'Pessoa jurídica' }, { value: 'pf', label: 'Pessoa física' }]} />
            </Label>
            {client.kind === 'pj' ? (
              <Label text="Razão social" error={errors.company}><input value={client.company} onChange={(event) => onChange({ ...client, company: event.target.value })} className={field} /></Label>
            ) : null}
            <Label text={client.kind === 'pj' ? 'Responsável' : 'Nome'} error={errors.name}><input value={client.name} onChange={(event) => onChange({ ...client, name: event.target.value })} className={field} /></Label>
            <Label text={client.kind === 'pj' ? 'CNPJ' : 'CPF'} error={errors.document}><input value={client.document} onChange={(event) => onChange({ ...client, document: event.target.value })} className={field} /></Label>
          </FormSection>
          <FormSection title="Contatos">
            <Label text="Telefone"><input value={client.phone} onChange={(event) => onChange({ ...client, phone: event.target.value })} className={field} /></Label>
            <Label text="WhatsApp"><input value={client.whatsapp} onChange={(event) => onChange({ ...client, whatsapp: event.target.value })} placeholder="Se for diferente do telefone" className={field} /></Label>
            <Label text="E-mail" error={errors.email}><input value={client.email} onChange={(event) => onChange({ ...client, email: event.target.value })} className={field} /></Label>
          </FormSection>
          <FormSection title="Dados complementares">
            <Label text="Endereço"><input value={client.address} onChange={(event) => onChange({ ...client, address: event.target.value })} className={field} /></Label>
            <Label text="Cidade"><input value={client.city} onChange={(event) => onChange({ ...client, city: event.target.value })} className={field} /></Label>
            <Label text="Informações complementares"><input value={client.extra} onChange={(event) => onChange({ ...client, extra: event.target.value })} className={field} /></Label>
            <Label text="Logo ou foto">
              <input type="file" accept="image/*" className="block w-full text-[12px]" onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                void readCatalogImage(file).then((image) => onChange({ ...client, avatar: image })).catch(() => undefined);
              }} />
            </Label>
            {client.avatar && <img src={client.avatar.dataUrl} alt="" className="h-14 w-14 rounded-full object-cover" />}
          </FormSection>
          <FormSection title="Observações">
            <textarea value={client.notes} onChange={(event) => onChange({ ...client, notes: event.target.value })} rows={3} className="w-full rounded-lg border border-[#E4EAF1] px-3 py-2 text-[12.5px] outline-none resize-none" />
          </FormSection>
        </div>
        <div className="border-t border-[#EEF2F7] px-5 py-3 flex justify-end gap-2">
          <button type="button" onClick={props.onClose} className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px]">Cancelar</button>
          <button type="button" onClick={props.onSave} disabled={props.saving} className="h-9 px-3.5 rounded-lg bg-[#071A34] text-white text-[12.5px] disabled:opacity-40">{props.saving ? 'Salvando…' : 'Salvar cliente'}</button>
        </div>
      </aside>
    </div>
  );
}

function Avatar({ client, small }: { client: ClientProfile; small?: boolean }) {
  const size = small ? 'w-8 h-8 text-[11px]' : 'w-10 h-10 text-[12px]';
  if (client.avatar) return <img src={client.avatar.dataUrl} alt="" className={`${size} rounded-full object-cover shrink-0`} />;
  return <span className={`${size} rounded-full text-white font-semibold inline-flex items-center justify-center shrink-0`} style={{ backgroundColor: client.accentColor }}>{client.initials}</span>;
}

function StatusText({ status }: { status: ClientLifecycle }) {
  const active = status === 'ativo';
  return <span className={`inline-flex h-6 items-center gap-1.5 px-2 rounded-full text-[11px] font-medium ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-[#F3F6FA] text-[#5A6B82]'}`}><span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-[#8A98AB]'}`} />{active ? 'Ativo' : 'Arquivado'}</span>;
}

function Stat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return <div className="flex items-center gap-2.5 min-w-[140px]"><Icon className="w-4 h-4 text-[#8A98AB]" /><div><div className="text-[16px] font-semibold text-[#071A34] leading-none tabular-nums">{value}</div><div className="text-[11.5px] text-[#5A6B82] mt-1">{label}</div></div></div>;
}

function SortHead({ label, active, align, onClick }: { label: string; active: boolean; align?: 'right'; onClick: () => void }) {
  return <th className={`py-2.5 px-3 ${align === 'right' ? 'text-right' : ''}`}><button type="button" onClick={onClick} className={active ? 'text-[#071A34]' : ''}>{label}</button></th>;
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-2.5"><h4 className="text-[12px] font-semibold uppercase tracking-[0.05em] text-[#5A6B82]">{title}</h4>{children}</section>;
}

function Label({ text, error, children }: { text: string; error?: string; children: ReactNode }) {
  return <label className="block space-y-1"><span className="text-[11.5px] text-[#5A6B82]">{text}</span>{children}{error && <span className="text-[11.5px] text-rose-700">{error}</span>}</label>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[11px] text-[#8A98AB]">{label}</dt><dd className="text-[#0F1E36] mt-0.5">{value}</dd></div>;
}

function FileGrid({
  files,
  onOpenChat,
}: {
  files: Array<{ id: string; name: string; format: string; detail: string; previewUrl?: string }>;
  onOpenChat: () => void;
}) {
  if (files.length === 0) return <p className="text-[#8A98AB]">Nenhuma arte ou arquivo vinculado.</p>;
  return (
    <div className="grid grid-cols-2 gap-3">
      {files.map((file) => (
          <article key={file.id} className="group rounded-xl border border-[#E7EDF3] overflow-hidden bg-white">
            <div className="relative h-[104px] bg-[#F6F8FB]">
              <FilePreview format={file.format} previewUrl={file.previewUrl} name={file.name} />
              <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-[#071A34]/28 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => void downloadClientFile(file)}
                  className="h-7 px-2 rounded-full bg-white text-[11.5px] text-[#071A34] inline-flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  Baixar
                </button>
                <button
                  type="button"
                  onClick={onOpenChat}
                  className="h-7 px-2 rounded-full bg-white text-[11.5px] text-[#071A34] inline-flex items-center gap-1"
                >
                  <MessageSquareText className="w-3.5 h-3.5" />
                  Ver na conversa
                </button>
              </div>
            </div>
            <div className="px-2.5 py-2">
              <div className="text-[12px] font-medium text-[#071A34] truncate">{file.name}</div>
              <div className="text-[11px] text-[#8A98AB] truncate">{file.format} · {file.detail}</div>
            </div>
          </article>
      ))}
    </div>
  );
}

function FilePreview({ format, previewUrl, name }: { format: string; previewUrl?: string; name: string }) {
  const kind = format.toUpperCase();
  if (previewUrl && ['PNG', 'JPG', 'JPEG', 'WEBP', 'SVG'].includes(kind)) {
    return <img src={previewUrl} alt={name} className="h-full w-full object-contain" />;
  }
  if (kind === 'SVG') {
    return (
      <svg viewBox="0 0 160 100" className="h-full w-full" aria-hidden>
        <rect width="160" height="100" fill="#F6F8FB" />
        <path d="M28 68 L58 32 L78 54 L102 24 L132 68 Z" fill="none" stroke="#1E3A5F" strokeWidth="3" />
        <circle cx="112" cy="34" r="6" fill="#C89B3C" />
      </svg>
    );
  }
  if (kind === 'PDF') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-14 h-[72px] rounded-sm bg-white border border-[#E4EAF1] px-2 py-2 shadow-[0_1px_2px_rgba(7,26,52,0.04)]">
          <div className="h-1.5 w-8 rounded bg-[#071A34]/80 mb-1.5" />
          <div className="h-1 w-10 rounded bg-[#E4EAF1] mb-1" />
          <div className="h-1 w-9 rounded bg-[#E4EAF1] mb-1" />
          <div className="h-1 w-7 rounded bg-[#E4EAF1]" />
          <FileText className="w-3.5 h-3.5 text-[#8A98AB] mt-2" />
        </div>
      </div>
    );
  }
  if (kind === 'PNG' || kind === 'JPG' || kind === 'JPEG' || kind === 'WEBP') {
    return (
      <div className="h-full flex flex-col items-center justify-center text-[#8A98AB]">
        <FileImage className="w-6 h-6" />
        <span className="mt-1 text-[11px]">{kind}</span>
      </div>
    );
  }
  return (
    <div className="h-full flex flex-col items-center justify-center text-[#8A98AB]">
      <PenTool className="w-6 h-6" />
      <span className="mt-1 text-[11px]">{kind || 'Arquivo'}</span>
    </div>
  );
}

async function downloadClientFile(file: { name: string; format: string; previewUrl?: string }) {
  const filename = file.name.includes('.') ? file.name : `${file.name}.${file.format.toLowerCase()}`;
  if (file.previewUrl) {
    if (file.previewUrl.startsWith('data:')) {
      triggerDownload(file.previewUrl, filename);
      return;
    }
    const response = await fetch(file.previewUrl);
    const blob = await response.blob();
    triggerDownload(URL.createObjectURL(blob), filename);
    return;
  }
  const kind = file.format.toUpperCase();
  if (kind === 'SVG') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#F6F8FB"/><text x="24" y="96" font-family="sans-serif" font-size="16" fill="#071A34">${file.name}</text></svg>`;
    triggerDownload(URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), filename);
    return;
  }
  if (kind === 'PDF') {
    const text = `%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`;
    triggerDownload(URL.createObjectURL(new Blob([text], { type: 'application/pdf' })), filename);
    return;
  }
  triggerDownload(URL.createObjectURL(new Blob([file.name], { type: 'text/plain' })), filename);
}

function triggerDownload(href: string, name: string) {
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  link.click();
}

function SimpleList({ items, empty }: { items: Array<{ id: string; title: string; detail: string }>; empty: string }) {
  if (items.length === 0) return <p className="text-[#8A98AB]">{empty}</p>;
  return <div className="divide-y divide-[#F1F5F9]">{items.map((item) => <div key={item.id} className="py-2.5"><div className="text-[13px] text-[#071A34]">{item.title}</div><div className="text-[12px] text-[#5A6B82]">{item.detail}</div></div>)}</div>;
}

function EmptyState({ title, text, actionLabel, onAction }: { title: string; text: string; actionLabel?: string; onAction?: () => void }) {
  return <div className="py-16 flex flex-col items-center text-center"><Users className="w-5 h-5 text-[#8A98AB]" /><h3 className="mt-3 text-[14px] font-semibold text-[#071A34]">{title}</h3><p className="mt-1 text-[12.5px] text-[#5A6B82] max-w-sm">{text}</p>{actionLabel && onAction && <button type="button" onClick={onAction} className="mt-4 h-9 px-3.5 rounded-lg bg-[#071A34] text-white text-[12.5px]">{actionLabel}</button>}</div>;
}

function buildFacts(client: ClientProfile, sales: SaleRecord[], activities: ClientActivity[]): ClientFacts {
  const ownSales = sales.filter((sale) => sale.clientId === client.id && sale.status !== 'cancelada');
  const activity = activities.find((item) => item.clientId === client.id);
  const activityAt = activity?.updatedAt || client.updatedAt;
  const recent = Date.now() - new Date(client.createdAt).getTime() < MONTH || Date.now() - new Date(activityAt).getTime() < MONTH;
  return {
    total: ownSales.reduce((sum, sale) => sum + sale.total, 0),
    orders: ownSales.length,
    projectCount: PROJECT_THREADS.filter((project) => project.clientId === client.id).length,
    lastPurchase: ownSales[0]?.date ?? '',
    lastActivity: formatDate(activityAt),
    lastActivityAt: activityAt,
    recent,
  };
}

function compareClients(a: ClientProfile, b: ClientProfile, sortKey: SortKey, facts: Map<string, ClientFacts>): number {
  const fa = facts.get(a.id);
  const fb = facts.get(b.id);
  if (sortKey === 'newest') return b.createdAt.localeCompare(a.createdAt);
  if (sortKey === 'oldest') return a.createdAt.localeCompare(b.createdAt);
  if (sortKey === 'activity') return (fb?.lastActivityAt ?? '').localeCompare(fa?.lastActivityAt ?? '');
  if (sortKey === 'volume_desc') return (fb?.total ?? 0) - (fa?.total ?? 0);
  if (sortKey === 'volume_asc') return (fa?.total ?? 0) - (fb?.total ?? 0);
  return displayName(a).localeCompare(displayName(b), 'pt-BR');
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
