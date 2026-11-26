import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  LayoutGrid,
  List,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { duplicateCatalogProduct, formatMoney, formatTemplateSize } from '../products/catalogApi';
import { catalogErrorMessage, deleteCatalogProduct, loadCatalog, saveCatalogProduct } from '../products/catalogStore';
import type { CatalogProduct, CatalogStatus } from '../products/catalogTypes';
import { PRODUCT_CATEGORIES } from '../products/catalogTypes';
import type { ProductCategory } from '../types';
import {
  blankCatalogProduct,
  firstCatalogError,
  hasCatalogErrors,
  validateCatalogProduct,
  type CatalogFieldErrors,
} from '../products/catalogValidation';
import { ProductEditor, StatusPill } from '../products/ProductEditor';
import { ProductThumb } from '../products/ProductVisuals';

interface ProductsPageProps {
  globalSearch: string;
}

type ViewMode = 'cards' | 'list';
type SortKey = 'name' | 'category' | 'cost' | 'price' | 'created';
type PanelMode = 'view' | 'edit' | 'create';
type TemplateFilter = 'todos' | 'com' | 'sem';
type CostFilter = 'todos' | 'com' | 'sem';

const PAGE_SIZE = 8;
const inputClass =
  'h-9 rounded-lg border border-[#E4EAF1] bg-white px-3 text-[12.5px] text-[#0F1E36] outline-none focus:border-[#C5D0DE]';

export function ProductsPage({ globalSearch }: ProductsPageProps) {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'todas' | ProductCategory>('todas');
  const [status, setStatus] = useState<'todos' | CatalogStatus>('todos');
  const [templates, setTemplates] = useState<TemplateFilter>('todos');
  const [costFilter, setCostFilter] = useState<CostFilter>('todos');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [view, setView] = useState<ViewMode>('cards');
  const [page, setPage] = useState(1);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelMode | null>(null);
  const [draft, setDraft] = useState<CatalogProduct | null>(null);
  const [fieldErrors, setFieldErrors] = useState<CatalogFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CatalogProduct | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const refresh = async () => {
    const items = await loadCatalog();
    setProducts(items);
    return items;
  };

  useEffect(() => {
    let active = true;
    loadCatalog()
      .then((items) => {
        if (active) setProducts(items);
      })
      .catch((error: unknown) => {
        if (active) setNotice({ tone: 'err', text: catalogErrorMessage(error) });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!menuId) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (menuRef.current?.contains(target)) return;
      if (target?.closest('[data-product-menu-trigger]')) return;
      setMenuId(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuId]);

  const filtered = useMemo(() => {
    const local = query.trim().toLowerCase();
    const global = globalSearch.trim().toLowerCase();
    const list = products.filter((product) => {
      if (category !== 'todas' && product.category !== category) return false;
      if (status !== 'todos' && product.status !== status) return false;
      if (templates === 'com' && product.templates.length === 0) return false;
      if (templates === 'sem' && product.templates.length > 0) return false;
      if (costFilter === 'com' && product.cost === null) return false;
      if (costFilter === 'sem' && product.cost !== null) return false;
      const name = product.name.toLowerCase();
      if (local && !name.includes(local)) return false;
      if (global && !name.includes(global) && !product.category.toLowerCase().includes(global)) return false;
      return true;
    });
    list.sort((a, b) => compareProducts(a, b, sortKey));
    return list;
  }, [products, query, globalSearch, category, status, templates, costFilter, sortKey]);

  useEffect(() => {
    setPage(1);
  }, [query, globalSearch, category, status, templates, costFilter, sortKey, view]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const filtersActive =
    query.trim().length > 0 || category !== 'todas' || status !== 'todos' || templates !== 'todos' || costFilter !== 'todos';

  const openCreate = () => {
    setDraft(blankCatalogProduct());
    setFieldErrors({});
    setPanel('create');
    setMenuId(null);
  };

  const openProduct = (product: CatalogProduct, mode: PanelMode) => {
    setDraft(structuredClone(product));
    setFieldErrors({});
    setPanel(mode);
    setMenuId(null);
  };

  const saveDraft = async () => {
    if (!draft) return;
    const errors = validateCatalogProduct(draft);
    setFieldErrors(errors);
    if (hasCatalogErrors(errors)) {
      setNotice({ tone: 'err', text: firstCatalogError(errors) ?? 'Revise os campos destacados.' });
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const next: CatalogProduct = {
        ...draft,
        name: draft.name.trim(),
        templates: draft.templates.map((template) => ({ ...template, name: template.name.trim() })),
        updatedAt: now,
      };
      await saveCatalogProduct(next);
      const items = await refresh();
      const saved = items.find((item) => item.id === next.id) ?? next;
      setDraft(saved);
      setPanel('view');
      setNotice({
        tone: 'ok',
        text: panel === 'create' ? 'Produto cadastrado.' : 'Alterações salvas.',
      });
    } catch (error) {
      setNotice({ tone: 'err', text: catalogErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const startDuplicate = (product: CatalogProduct) => {
    setDraft(duplicateCatalogProduct(product));
    setFieldErrors({});
    setPanel('create');
    setMenuId(null);
    setNotice({ tone: 'ok', text: 'Cópia pronta para revisão. Ela só será gravada ao salvar.' });
  };

  const archiveProduct = async (product: CatalogProduct) => {
    const nextStatus: CatalogStatus = product.status === 'arquivado' ? 'ativo' : 'arquivado';
    try {
      const next = { ...product, status: nextStatus, updatedAt: new Date().toISOString() };
      await saveCatalogProduct(next);
      await refresh();
      setDraft((current) => (current?.id === product.id ? next : current));
      setMenuId(null);
      setNotice({
        tone: 'ok',
        text: nextStatus === 'arquivado' ? 'Produto arquivado.' : 'Produto reativado.',
      });
    } catch (error) {
      setNotice({ tone: 'err', text: catalogErrorMessage(error) });
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteCatalogProduct(pendingDelete.id);
      await refresh();
      if (draft?.id === pendingDelete.id) {
        setPanel(null);
        setDraft(null);
      }
      setNotice({ tone: 'ok', text: 'Produto excluído. Vendas já registradas não são alteradas.' });
    } catch (error) {
      setNotice({ tone: 'err', text: catalogErrorMessage(error) });
    } finally {
      setPendingDelete(null);
      setMenuId(null);
    }
  };

  const clearFilters = () => {
    setQuery('');
    setCategory('todas');
    setStatus('todos');
    setTemplates('todos');
    setCostFilter('todos');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-[#071A34] tracking-[-0.015em]">Produtos</h2>
          <p className="text-[12.5px] text-[#5A6B82] mt-0.5">
            Gerencie seu catálogo, templates, formatos e custos.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="h-9 px-3.5 rounded-lg bg-[#071A34] text-white text-[12.5px] font-medium hover:bg-[#0D284D] transition-colors inline-flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5 text-[#E3C16F]" />
          Adicionar produto
        </button>
      </div>

      {notice && (
        <div
          role="status"
          className={`rounded-lg px-3 py-2 text-[12.5px] ${
            notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[180px] flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 text-[#8A98AB] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar produto"
            aria-label="Buscar produto por nome"
            className={`${inputClass} w-full pl-8`}
          />
        </label>
        <select
          value={category}
          aria-label="Filtrar por categoria"
          onChange={(event) => setCategory(event.target.value as 'todas' | ProductCategory)}
          className={inputClass}
        >
          <option value="todas">Todas as categorias</option>
          {PRODUCT_CATEGORIES.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <select
          value={status}
          aria-label="Filtrar por status"
          onChange={(event) => setStatus(event.target.value as 'todos' | CatalogStatus)}
          className={inputClass}
        >
          <option value="todos">Todos os status</option>
          <option value="ativo">Ativos</option>
          <option value="arquivado">Arquivados</option>
        </select>
        <select
          value={templates}
          aria-label="Filtrar por templates"
          onChange={(event) => setTemplates(event.target.value as TemplateFilter)}
          className={inputClass}
        >
          <option value="todos">Templates</option>
          <option value="com">Com templates</option>
          <option value="sem">Sem templates</option>
        </select>
        <select
          value={costFilter}
          aria-label="Filtrar por custo"
          onChange={(event) => setCostFilter(event.target.value as CostFilter)}
          className={inputClass}
        >
          <option value="todos">Custo</option>
          <option value="com">Com custo</option>
          <option value="sem">Sem custo</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={sortKey}
            aria-label="Ordenar produtos"
            onChange={(event) => setSortKey(event.target.value as SortKey)}
            className={inputClass}
          >
            <option value="name">Nome</option>
            <option value="category">Categoria</option>
            <option value="cost">Custo</option>
            <option value="price">Preço</option>
            <option value="created">Data de cadastro</option>
          </select>
          <div className="flex h-9 rounded-lg border border-[#E4EAF1] bg-white p-0.5">
            <button
              type="button"
              aria-label="Visualizar em cards"
              aria-pressed={view === 'cards'}
              onClick={() => setView('cards')}
              className={`h-8 w-8 rounded-md inline-flex items-center justify-center ${view === 'cards' ? 'bg-[#071A34] text-white' : 'text-[#5A6B82]'}`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              aria-label="Visualizar em lista"
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
              className={`h-8 w-8 rounded-md inline-flex items-center justify-center ${view === 'list' ? 'bg-[#071A34] text-white' : 'text-[#5A6B82]'}`}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-64 rounded-lg bg-white border border-[#E4EAF1] animate-pulse" />
          ))}
        </div>
      ) : products.length === 0 ? (
        <EmptyState
          title="Nenhum produto no catálogo"
          text="Cadastre o primeiro item para organizar formatos, templates e preços."
          actionLabel="Adicionar produto"
          onAction={openCreate}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={query.trim() ? 'Nenhum produto encontrado' : 'Nenhum produto com esses filtros'}
          text={
            query.trim()
              ? `Não há resultados para “${query.trim()}”.`
              : 'Ajuste a categoria, o status, os templates ou o custo.'
          }
          actionLabel={filtersActive ? 'Limpar filtros' : undefined}
          onAction={filtersActive ? clearFilters : undefined}
        />
      ) : view === 'cards' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
          {visible.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              menuOpen={menuId === product.id}
              menuRef={menuRef}
              onOpen={() => openProduct(product, 'view')}
              onToggleMenu={() => setMenuId((current) => (current === product.id ? null : product.id))}
              onEdit={() => openProduct(product, 'edit')}
              onDuplicate={() => startDuplicate(product)}
              onArchive={() => void archiveProduct(product)}
              onAskDelete={() => setPendingDelete(product)}
            />
          ))}
        </div>
      ) : (
        <ProductTable
          products={visible}
          menuId={menuId}
          menuRef={menuRef}
          onOpen={(product) => openProduct(product, 'view')}
          onToggleMenu={(id) => setMenuId((current) => (current === id ? null : id))}
          onEdit={(product) => openProduct(product, 'edit')}
          onDuplicate={startDuplicate}
          onArchive={(product) => void archiveProduct(product)}
          onAskDelete={setPendingDelete}
        />
      )}

      {!loading && filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-[12px] text-[#5A6B82]">
            {filtered.length} produtos · página {currentPage} de {pageCount}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              aria-label="Página anterior"
              className="h-8 w-8 rounded-lg border border-[#E4EAF1] bg-white disabled:opacity-40 inline-flex items-center justify-center"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={currentPage === pageCount}
              onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
              aria-label="Próxima página"
              className="h-8 w-8 rounded-lg border border-[#E4EAF1] bg-white disabled:opacity-40 inline-flex items-center justify-center"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {panel && draft && (
        <ProductEditor
          mode={panel}
          draft={draft}
          errors={fieldErrors}
          saving={saving}
          onChange={setDraft}
          onClose={() => {
            setPanel(null);
            setDraft(null);
            setFieldErrors({});
          }}
          onEdit={() => setPanel('edit')}
          onSave={() => void saveDraft()}
          onDuplicate={() => startDuplicate(draft)}
          onArchive={() => void archiveProduct(draft)}
          onAskDelete={() => setPendingDelete(draft)}
        />
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-[#071A34]/25" aria-label="Cancelar exclusão" onClick={() => setPendingDelete(null)} />
          <div className="relative w-full max-w-sm bg-white border border-[#E4EAF1] rounded-lg p-5 shadow-xl">
            <h3 className="text-[15px] font-semibold text-[#071A34]">Excluir produto</h3>
            <p className="mt-1.5 text-[12.5px] text-[#5A6B82]">
              {pendingDelete.name} será removido do catálogo. Vendas e pedidos já registrados permanecem com os valores da época.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setPendingDelete(null)} className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px]">
                Cancelar
              </button>
              <button type="button" onClick={() => void confirmDelete()} className="h-9 px-3 rounded-lg bg-[#071A34] text-white text-[12.5px]">
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductCard({
  product,
  menuOpen,
  menuRef,
  onOpen,
  onToggleMenu,
  onEdit,
  onDuplicate,
  onArchive,
  onAskDelete,
}: {
  product: CatalogProduct;
  menuOpen: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  onOpen: () => void;
  onToggleMenu: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onAskDelete: () => void;
}) {
  const size = product.templates[0] ? formatTemplateSize(product.templates[0]) : '';
  return (
    <article className={`bg-white border border-[#E4EAF1] rounded-lg overflow-hidden flex flex-col hover:border-[#D5DEE8] hover:shadow-[0_8px_22px_rgba(7,26,52,0.05)] ${product.status === 'arquivado' ? 'opacity-80' : ''}`}>
      <div className="relative">
        <button type="button" onClick={onOpen} className="block w-full text-left">
          <ProductThumb product={product} className="h-[148px] w-full" />
        </button>
        <div className="absolute top-2 right-2">
          <button
            type="button"
            data-product-menu-trigger
            aria-expanded={menuOpen}
            aria-label={`Ações de ${product.name}`}
            onClick={onToggleMenu}
            className="h-7 w-7 rounded-md bg-white/95 border border-[#E4EAF1] text-[#5A6B82] inline-flex items-center justify-center"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {menuOpen && (
            <ActionMenu
              menuRef={menuRef}
              archived={product.status === 'arquivado'}
              onView={onOpen}
              onEdit={onEdit}
              onDuplicate={onDuplicate}
              onArchive={onArchive}
              onDelete={onAskDelete}
            />
          )}
        </div>
      </div>
      <button type="button" onClick={onOpen} className="px-3.5 py-3 text-left flex flex-col gap-2 flex-1">
        <div>
          <div className="text-[13.5px] font-semibold text-[#071A34] leading-snug line-clamp-2">{product.name}</div>
          <p className="text-[12px] text-[#5A6B82] mt-0.5">{product.category}</p>
        </div>
        <p className="text-[12px] text-[#334155]">
          {size || 'Sem formato'}
          <span className="text-[#8A98AB]"> · {product.templates.length} {product.templates.length === 1 ? 'template' : 'templates'}</span>
        </p>
        <div className="mt-auto flex items-end justify-between gap-2">
          <div>
            <div className="text-[11px] text-[#8A98AB]">Custo {product.cost === null ? '—' : formatMoney(product.cost)}</div>
            <div className="text-[14px] font-semibold text-[#071A34] tabular-nums">
              {product.price === null ? 'Sob consulta' : formatMoney(product.price)}
            </div>
          </div>
          <StatusPill status={product.status} />
        </div>
      </button>
    </article>
  );
}

function ProductTable({
  products,
  menuId,
  menuRef,
  onOpen,
  onToggleMenu,
  onEdit,
  onDuplicate,
  onArchive,
  onAskDelete,
}: {
  products: CatalogProduct[];
  menuId: string | null;
  menuRef: RefObject<HTMLDivElement | null>;
  onOpen: (product: CatalogProduct) => void;
  onToggleMenu: (id: string) => void;
  onEdit: (product: CatalogProduct) => void;
  onDuplicate: (product: CatalogProduct) => void;
  onArchive: (product: CatalogProduct) => void;
  onAskDelete: (product: CatalogProduct) => void;
}) {
  return (
    <div className="bg-white border border-[#E4EAF1] rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[760px]">
          <thead>
            <tr className="border-b border-[#EEF2F7] bg-[#FAFBFD] text-[11.5px] font-medium text-[#5A6B82]">
              <th className="py-2.5 px-4 font-medium">Produto</th>
              <th className="py-2.5 px-3 font-medium">Categoria</th>
              <th className="py-2.5 px-3 font-medium">Formato</th>
              <th className="py-2.5 px-3 font-medium text-right">Templates</th>
              <th className="py-2.5 px-3 font-medium text-right">Custo</th>
              <th className="py-2.5 px-3 font-medium text-right">Preço</th>
              <th className="py-2.5 px-3 font-medium">Status</th>
              <th className="py-2.5 px-3 w-12"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9] text-[13px]">
            {products.map((product) => (
              <tr key={product.id} className={`hover:bg-[#F8FAFC] ${product.status === 'arquivado' ? 'opacity-75' : ''}`}>
                <td className="py-2.5 px-4">
                  <button type="button" onClick={() => onOpen(product)} className="flex items-center gap-3 text-left">
                    <ProductThumb product={product} className="w-11 h-11 rounded-md shrink-0" />
                    <span className="font-medium text-[#071A34]">{product.name}</span>
                  </button>
                </td>
                <td className="py-2.5 px-3 text-[#334155] whitespace-nowrap">{product.category}</td>
                <td className="py-2.5 px-3 whitespace-nowrap text-[#0F1E36]">
                  {product.templates[0] ? formatTemplateSize(product.templates[0]) || '—' : '—'}
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums">{product.templates.length}</td>
                <td className="py-2.5 px-3 text-right tabular-nums text-[#5A6B82]">{product.cost === null ? '—' : formatMoney(product.cost)}</td>
                <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-[#071A34]">{product.price === null ? '—' : formatMoney(product.price)}</td>
                <td className="py-2.5 px-3"><StatusPill status={product.status} /></td>
                <td className="py-2.5 px-3">
                  <button
                    type="button"
                    data-product-menu-trigger
                    aria-expanded={menuId === product.id}
                    aria-label={`Ações de ${product.name}`}
                    onClick={() => onToggleMenu(product.id)}
                    className="h-7 w-7 rounded-md text-[#5A6B82] hover:bg-[#F3F6FA] inline-flex items-center justify-center"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                  {menuId === product.id && (
                    <ActionMenu
                      menuRef={menuRef}
                      archived={product.status === 'arquivado'}
                      onView={() => onOpen(product)}
                      onEdit={() => onEdit(product)}
                      onDuplicate={() => onDuplicate(product)}
                      onArchive={() => onArchive(product)}
                      onDelete={() => onAskDelete(product)}
                    />
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

function ActionMenu({
  menuRef,
  archived,
  onView,
  onEdit,
  onDuplicate,
  onArchive,
  onDelete,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  archived: boolean;
  onView: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    const place = () => {
      const anchor = document.querySelector('[data-product-menu-trigger][aria-expanded="true"]')?.getBoundingClientRect();
      if (!anchor) return;
      const width = 188;
      const height = 188;
      const left = Math.min(Math.max(8, anchor.right - width), window.innerWidth - width - 8);
      const below = anchor.bottom + 6;
      const top = below + height > window.innerHeight - 8 ? Math.max(8, anchor.top - height - 6) : below;
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, []);

  const Item = ({
    icon: Icon,
    label,
    onClick,
    danger,
  }: {
    icon: typeof Eye;
    label: string;
    onClick: () => void;
    danger?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`w-full px-2.5 py-1.5 text-left text-[12.5px] inline-flex items-center gap-2 hover:bg-[#F6F8FB] ${danger ? 'text-rose-700' : 'text-[#0F1E36]'}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );

  return createPortal(
    <div
      ref={menuRef}
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-30 w-[188px] rounded-lg border border-[#E4EAF1] bg-white shadow-[0_10px_28px_rgba(7,26,52,0.08)] py-1"
    >
      <Item icon={Eye} label="Visualizar detalhes" onClick={onView} />
      <Item icon={Pencil} label="Editar" onClick={onEdit} />
      <Item icon={Copy} label="Duplicar" onClick={onDuplicate} />
      <Item icon={Archive} label={archived ? 'Reativar' : 'Arquivar'} onClick={onArchive} />
      <Item icon={Trash2} label="Excluir" onClick={onDelete} danger />
    </div>,
    document.body
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
        <Package className="w-5 h-5" />
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

function compareProducts(a: CatalogProduct, b: CatalogProduct, sortKey: SortKey): number {
  if (sortKey === 'category') return a.category.localeCompare(b.category, 'pt-BR') || a.name.localeCompare(b.name, 'pt-BR');
  if (sortKey === 'cost') return compareNullable(a.cost, b.cost);
  if (sortKey === 'price') return compareNullable(a.price, b.price);
  if (sortKey === 'created') return b.createdAt.localeCompare(a.createdAt);
  return a.name.localeCompare(b.name, 'pt-BR');
}

function compareNullable(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}
