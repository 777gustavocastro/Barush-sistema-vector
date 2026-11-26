import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  ImageOff,
  LayoutGrid,
  List,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { PRODUCT_CATALOG, formatBRL } from '../data/mockData';
import type { ProductCategory, ProductConfig, ProductRecord, ProductStatus } from '../types';

interface ProductsPageProps {
  globalSearch: string;
}

type ViewMode = 'cards' | 'list';
type SortKey = 'name_asc' | 'name_desc' | 'price_asc' | 'price_desc' | 'templates';
type PanelMode = 'view' | 'edit' | 'create';

const CATEGORIES: ProductCategory[] = [
  'Impressão gráfica',
  'Personalização',
  'Comunicação visual',
  'Personalização a laser',
  'Uniformes',
  'Outros',
];

const CONFIGS: ProductConfig[] = ['Template', 'Formato fixo', 'Sob medida'];
const PAGE_SIZE = 9;

const STATUS_LABEL: Record<ProductStatus, string> = {
  ativo: 'Ativo',
  rascunho: 'Rascunho',
  arquivado: 'Arquivado',
};

const inputClass =
  'h-9 rounded-lg border border-[#E4EAF1] bg-white px-3 text-[12.5px] text-[#0F1E36] outline-none focus:border-[#C5D0DE]';

export function ProductsPage({ globalSearch }: ProductsPageProps) {
  const [products, setProducts] = useState<ProductRecord[]>(() =>
    PRODUCT_CATALOG.map((product) => ({ ...product }))
  );
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'todas' | ProductCategory>('todas');
  const [status, setStatus] = useState<'todos' | ProductStatus>('todos');
  const [config, setConfig] = useState<'todas' | ProductConfig>('todas');
  const [sortKey, setSortKey] = useState<SortKey>('name_asc');
  const [view, setView] = useState<ViewMode>('cards');
  const [page, setPage] = useState(1);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelMode | null>(null);
  const [draft, setDraft] = useState<ProductRecord | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 280);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!menuId) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (menuRef.current?.contains(target)) return;
      if (target?.closest('[data-product-menu-trigger]')) return;
      setMenuId(null);
      setConfirmDeleteId(null);
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
      if (config !== 'todas' && product.config !== config) return false;
      const haystack = `${product.name} ${product.sku} ${product.summary}`.toLowerCase();
      if (local && !haystack.includes(local)) return false;
      if (global && !haystack.includes(global) && !product.category.toLowerCase().includes(global)) {
        return false;
      }
      return true;
    });

    list.sort((a, b) => {
      if (sortKey === 'name_desc') return b.name.localeCompare(a.name, 'pt-BR');
      if (sortKey === 'price_asc') return a.price - b.price;
      if (sortKey === 'price_desc') return b.price - a.price;
      if (sortKey === 'templates') return b.templateCount - a.templateCount;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
    return list;
  }, [products, query, globalSearch, category, status, config, sortKey]);

  useEffect(() => {
    setPage(1);
  }, [query, globalSearch, category, status, config, sortKey, view]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const filtersActive =
    category !== 'todas' || status !== 'todos' || config !== 'todas' || query.trim().length > 0;
  const catalogEmpty = products.length === 0;

  const openCreate = () => {
    setDraft(blankProduct());
    setPanel('create');
    setMenuId(null);
  };

  const openProduct = (product: ProductRecord, mode: PanelMode) => {
    setDraft({ ...product });
    setPanel(mode);
    setMenuId(null);
  };

  const saveDraft = () => {
    if (!draft || !draft.name.trim()) return;
    const next: ProductRecord = {
      ...draft,
      name: draft.name.trim(),
      sku: draft.sku.trim() || `PRD-${Date.now().toString().slice(-4)}`,
      active: draft.status !== 'arquivado',
      templateCount: Math.max(0, Number(draft.templateCount) || 0),
      cost: Number(draft.cost) || 0,
      price: Number(draft.price) || 0,
    };
    setProducts((current) => {
      const exists = current.some((item) => item.id === next.id);
      return exists
        ? current.map((item) => (item.id === next.id ? next : item))
        : [next, ...current];
    });
    setDraft(next);
    setPanel('view');
  };

  const duplicateProduct = (product: ProductRecord) => {
    const copy: ProductRecord = {
      ...product,
      id: `prd-${Date.now()}`,
      sku: `${product.sku}-C`,
      name: `${product.name} (cópia)`,
      status: 'rascunho',
      active: true,
    };
    setProducts((current) => [copy, ...current]);
    setMenuId(null);
    setDraft(copy);
    setPanel('view');
  };

  const archiveProduct = (product: ProductRecord) => {
    const nextStatus: ProductStatus = product.status === 'arquivado' ? 'ativo' : 'arquivado';
    setProducts((current) =>
      current.map((item) =>
        item.id === product.id
          ? { ...item, status: nextStatus, active: nextStatus !== 'arquivado' }
          : item
      )
    );
    setDraft((current) =>
      current && current.id === product.id
        ? { ...current, status: nextStatus, active: nextStatus !== 'arquivado' }
        : current
    );
    setMenuId(null);
  };

  const deleteProduct = (id: string) => {
    setProducts((current) => current.filter((item) => item.id !== id));
    setConfirmDeleteId(null);
    setMenuId(null);
    if (draft?.id === id) {
      setPanel(null);
      setDraft(null);
    }
  };

  const clearFilters = () => {
    setQuery('');
    setCategory('todas');
    setStatus('todos');
    setConfig('todas');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold text-[#071A34] tracking-[-0.015em]">
            Produtos
          </h2>
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

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[190px] flex-1 max-w-xs">
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
          onChange={(event) => setCategory(event.target.value as 'todas' | ProductCategory)}
          aria-label="Filtrar por categoria"
          className={inputClass}
        >
          <option value="todas">Todas as categorias</option>
          {CATEGORIES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as 'todos' | ProductStatus)}
          aria-label="Filtrar por status"
          className={inputClass}
        >
          <option value="todos">Todos os status</option>
          <option value="ativo">Ativos</option>
          <option value="rascunho">Rascunhos</option>
          <option value="arquivado">Arquivados</option>
        </select>

        <select
          value={config}
          onChange={(event) => setConfig(event.target.value as 'todas' | ProductConfig)}
          aria-label="Filtrar por configuração"
          className={inputClass}
        >
          <option value="todas">Todas as configurações</option>
          {CONFIGS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2">
          <select
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as SortKey)}
            aria-label="Ordenar produtos"
            className={inputClass}
          >
            <option value="name_asc">Nome A–Z</option>
            <option value="name_desc">Nome Z–A</option>
            <option value="price_asc">Menor preço</option>
            <option value="price_desc">Maior preço</option>
            <option value="templates">Mais templates</option>
          </select>

          <div className="flex h-9 rounded-lg border border-[#E4EAF1] bg-white p-0.5">
            <button
              type="button"
              onClick={() => setView('cards')}
              aria-label="Visualizar em cards"
              aria-pressed={view === 'cards'}
              className={`h-8 w-8 rounded-md inline-flex items-center justify-center transition-colors ${
                view === 'cards' ? 'bg-[#071A34] text-white' : 'text-[#5A6B82] hover:text-[#071A34]'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              aria-label="Visualizar em lista"
              aria-pressed={view === 'list'}
              className={`h-8 w-8 rounded-md inline-flex items-center justify-center transition-colors ${
                view === 'list' ? 'bg-[#071A34] text-white' : 'text-[#5A6B82] hover:text-[#071A34]'
              }`}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <ProductSkeleton view={view} />
      ) : catalogEmpty ? (
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
              : 'Ajuste a categoria, o status ou a configuração para ver outros itens.'
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
              menuRef={menuId === product.id ? menuRef : undefined}
              confirmDelete={confirmDeleteId === product.id}
              onToggleMenu={() => setMenuId((current) => (current === product.id ? null : product.id))}
              onView={() => openProduct(product, 'view')}
              onEdit={() => openProduct(product, 'edit')}
              onDuplicate={() => duplicateProduct(product)}
              onArchive={() => archiveProduct(product)}
              onAskDelete={() => setConfirmDeleteId(product.id)}
              onCancelDelete={() => setConfirmDeleteId(null)}
              onDelete={() => deleteProduct(product.id)}
            />
          ))}
        </div>
      ) : (
        <ProductTable
          products={visible}
          menuId={menuId}
          menuRef={menuRef}
          confirmDeleteId={confirmDeleteId}
          onToggleMenu={(id) => setMenuId((current) => (current === id ? null : id))}
          onView={(product) => openProduct(product, 'view')}
          onEdit={(product) => openProduct(product, 'edit')}
          onDuplicate={duplicateProduct}
          onArchive={archiveProduct}
          onAskDelete={setConfirmDeleteId}
          onCancelDelete={() => setConfirmDeleteId(null)}
          onDelete={deleteProduct}
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
              className="h-8 w-8 rounded-lg border border-[#E4EAF1] bg-white text-[#071A34] disabled:opacity-40 inline-flex items-center justify-center"
              aria-label="Página anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={currentPage === pageCount}
              onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
              className="h-8 w-8 rounded-lg border border-[#E4EAF1] bg-white text-[#071A34] disabled:opacity-40 inline-flex items-center justify-center"
              aria-label="Próxima página"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {panel && draft && (
        <ProductPanel
          mode={panel}
          draft={draft}
          onChange={setDraft}
          onClose={() => {
            setPanel(null);
            setDraft(null);
          }}
          onEdit={() => setPanel('edit')}
          onSave={saveDraft}
          onDuplicate={() => duplicateProduct(draft)}
          onArchive={() => archiveProduct(draft)}
        />
      )}
    </div>
  );
}

function ProductCard({
  product,
  menuOpen,
  menuRef,
  confirmDelete,
  onToggleMenu,
  onView,
  onEdit,
  onDuplicate,
  onArchive,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  product: ProductRecord;
  menuOpen: boolean;
  menuRef?: RefObject<HTMLDivElement | null>;
  confirmDelete: boolean;
  onToggleMenu: () => void;
  onView: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  const archived = product.status === 'arquivado';
  return (
    <article
      className={`group bg-white border border-[#E4EAF1] rounded-lg overflow-hidden flex flex-col transition-all hover:border-[#D5DEE8] hover:shadow-[0_8px_22px_rgba(7,26,52,0.05)] ${
        archived ? 'opacity-80' : ''
      }`}
    >
      <div className="relative">
        <button type="button" onClick={onView} className="block w-full text-left">
          <ProductThumb product={product} className="h-[148px] w-full" />
        </button>
        <div className="absolute top-2 right-2">
          <button
            type="button"
            data-product-menu-trigger
            onClick={onToggleMenu}
            aria-label={`Ações de ${product.name}`}
            aria-expanded={menuOpen}
            className="h-7 w-7 rounded-md bg-white/95 border border-[#E4EAF1] text-[#5A6B82] hover:text-[#071A34] inline-flex items-center justify-center"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {menuOpen && (
            <ActionMenu
              menuRef={menuRef}
              archived={archived}
              confirmDelete={confirmDelete}
              onView={onView}
              onEdit={onEdit}
              onDuplicate={onDuplicate}
              onArchive={onArchive}
              onAskDelete={onAskDelete}
              onCancelDelete={onCancelDelete}
              onDelete={onDelete}
            />
          )}
        </div>
      </div>

      <div className="px-3.5 py-3 flex flex-col gap-2 flex-1">
        <div className="min-h-[58px]">
          <button
            type="button"
            onClick={onView}
            className="text-left text-[13.5px] font-semibold text-[#071A34] leading-snug line-clamp-2 hover:text-[#0D284D]"
          >
            {product.name}
          </button>
          <p className="text-[12px] text-[#5A6B82] mt-0.5">{product.category}</p>
        </div>
        <p className="text-[12px] text-[#334155]">
          {product.proportion ? `${product.proportion} · ` : ''}
          {product.dimensions}
          <span className="text-[#8A98AB]">
            {' '}
            · {product.templateCount}{' '}
            {product.templateCount === 1 ? 'template' : 'templates'}
          </span>
        </p>
        <div className="mt-auto pt-1 flex items-end justify-between gap-2">
          <div>
            <div className="text-[11px] text-[#8A98AB]">Custo {formatBRL(product.cost)}</div>
            <div className="text-[14px] font-semibold text-[#071A34] tabular-nums leading-tight">
              {formatBRL(product.price)}
            </div>
          </div>
          <StatusBadge status={product.status} />
        </div>
      </div>
    </article>
  );
}

function ProductTable({
  products,
  menuId,
  menuRef,
  confirmDeleteId,
  onToggleMenu,
  onView,
  onEdit,
  onDuplicate,
  onArchive,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  products: ProductRecord[];
  menuId: string | null;
  menuRef: RefObject<HTMLDivElement | null>;
  confirmDeleteId: string | null;
  onToggleMenu: (id: string) => void;
  onView: (product: ProductRecord) => void;
  onEdit: (product: ProductRecord) => void;
  onDuplicate: (product: ProductRecord) => void;
  onArchive: (product: ProductRecord) => void;
  onAskDelete: (id: string) => void;
  onCancelDelete: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="bg-white border border-[#E4EAF1] rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[760px]">
          <thead>
            <tr className="border-b border-[#EEF2F7] bg-[#FAFBFD] text-[11.5px] font-medium text-[#5A6B82]">
              <th className="py-2.5 px-4 font-medium">Produto</th>
              <th className="py-2.5 px-3 font-medium">Categoria</th>
              <th className="py-2.5 px-3 font-medium">Formato / dimensão</th>
              <th className="py-2.5 px-3 font-medium text-right">Templates</th>
              <th className="py-2.5 px-3 font-medium text-right">Custo</th>
              <th className="py-2.5 px-3 font-medium text-right">Preço</th>
              <th className="py-2.5 px-3 font-medium">Status</th>
              <th className="py-2.5 px-3 font-medium w-12">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9] text-[13px]">
            {products.map((product) => (
              <tr
                key={product.id}
                className={`hover:bg-[#F8FAFC] transition-colors ${
                  product.status === 'arquivado' ? 'opacity-75' : ''
                }`}
              >
                <td className="py-2.5 px-4">
                  <button
                    type="button"
                    onClick={() => onView(product)}
                    className="flex items-center gap-3 text-left min-w-0"
                  >
                    <ProductThumb product={product} className="w-11 h-11 rounded-md shrink-0" />
                    <span className="min-w-0">
                      <span className="block font-medium text-[#071A34] truncate max-w-[260px]">
                        {product.name}
                      </span>
                      <span className="block text-[11.5px] text-[#5A6B82] truncate max-w-[260px]">
                        {product.summary}
                      </span>
                    </span>
                  </button>
                </td>
                <td className="py-2.5 px-3 text-[#334155] whitespace-nowrap">{product.category}</td>
                <td className="py-2.5 px-3 whitespace-nowrap">
                  <div className="text-[#0F1E36]">{product.dimensions}</div>
                  {product.proportion && (
                    <div className="text-[11.5px] text-[#5A6B82] font-mono">{product.proportion}</div>
                  )}
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums text-[#334155]">
                  {product.templateCount}
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums text-[#5A6B82] whitespace-nowrap">
                  {formatBRL(product.cost)}
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-[#071A34] whitespace-nowrap">
                  {formatBRL(product.price)}
                </td>
                <td className="py-2.5 px-3">
                  <StatusBadge status={product.status} />
                </td>
                <td className="py-2.5 px-3">
                  <div className="relative">
                    <button
                      type="button"
                      data-product-menu-trigger
                      onClick={() => onToggleMenu(product.id)}
                      aria-label={`Ações de ${product.name}`}
                      aria-expanded={menuId === product.id}
                      className="h-7 w-7 rounded-md text-[#5A6B82] hover:bg-[#F3F6FA] hover:text-[#071A34] inline-flex items-center justify-center"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                    {menuId === product.id && (
                      <ActionMenu
                        menuRef={menuRef}
                        archived={product.status === 'arquivado'}
                        confirmDelete={confirmDeleteId === product.id}
                        onView={() => onView(product)}
                        onEdit={() => onEdit(product)}
                        onDuplicate={() => onDuplicate(product)}
                        onArchive={() => onArchive(product)}
                        onAskDelete={() => onAskDelete(product.id)}
                        onCancelDelete={onCancelDelete}
                        onDelete={() => onDelete(product.id)}
                      />
                    )}
                  </div>
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
  confirmDelete,
  onView,
  onEdit,
  onDuplicate,
  onArchive,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  menuRef?: RefObject<HTMLDivElement | null>;
  archived: boolean;
  confirmDelete: boolean;
  onView: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    const place = () => {
      const anchor = document
        .querySelector('[data-product-menu-trigger][aria-expanded="true"]')
        ?.getBoundingClientRect();
      if (!anchor) return;
      const width = 188;
      const height = confirmDelete ? 214 : 188;
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
  }, [confirmDelete]);

  return createPortal(
    <div
      ref={(node) => {
        localRef.current = node;
        if (menuRef) menuRef.current = node;
      }}
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-30 w-[188px] rounded-lg border border-[#E4EAF1] bg-white shadow-[0_10px_28px_rgba(7,26,52,0.08)] py-1"
    >
      <MenuItem icon={Eye} label="Visualizar detalhes" onClick={onView} />
      <MenuItem icon={Pencil} label="Editar" onClick={onEdit} />
      <MenuItem icon={Copy} label="Duplicar" onClick={onDuplicate} />
      <MenuItem icon={Archive} label={archived ? 'Reativar' : 'Arquivar'} onClick={onArchive} />
      {confirmDelete ? (
        <div className="px-2.5 py-2 border-t border-[#EEF2F7]">
          <p className="text-[11.5px] text-[#5A6B82] mb-1.5">Excluir este produto?</p>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={onDelete}
              className="h-7 flex-1 rounded-md bg-[#071A34] text-white text-[11.5px]"
            >
              Excluir
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              className="h-7 flex-1 rounded-md border border-[#E4EAF1] text-[11.5px] text-[#334155]"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <MenuItem icon={Trash2} label="Excluir" onClick={onAskDelete} danger />
      )}
    </div>,
    document.body
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Eye;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full px-2.5 py-1.5 text-left text-[12.5px] inline-flex items-center gap-2 hover:bg-[#F6F8FB] ${
        danger ? 'text-rose-700' : 'text-[#0F1E36]'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

function ProductPanel({
  mode,
  draft,
  onChange,
  onClose,
  onEdit,
  onSave,
  onDuplicate,
  onArchive,
}: {
  mode: PanelMode;
  draft: ProductRecord;
  onChange: (next: ProductRecord) => void;
  onClose: () => void;
  onEdit: () => void;
  onSave: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
}) {
  const editing = mode !== 'view';
  const title = mode === 'create' ? 'Novo produto' : mode === 'edit' ? 'Editar produto' : draft.name;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Fechar painel" className="absolute inset-0 bg-[#071A34]/20" onClick={onClose} />
      <aside className="relative h-full w-full max-w-md bg-white border-l border-[#E4EAF1] shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-[#EEF2F7] px-5 py-3.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.06em] text-[#8A98AB]">
              {mode === 'view' ? 'Detalhes' : mode === 'edit' ? 'Edição' : 'Cadastro'}
            </p>
            <h3 className="text-[15px] font-semibold text-[#071A34] truncate">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="h-8 w-8 rounded-lg text-[#5A6B82] hover:bg-[#F3F6FA] inline-flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <ProductThumb product={draft} className="h-40 w-full rounded-lg" />

          {editing ? (
            <div className="space-y-3">
              <Field label="Nome">
                <input
                  value={draft.name}
                  onChange={(event) => onChange({ ...draft, name: event.target.value })}
                  className={`${inputClass} w-full`}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="SKU">
                  <input
                    value={draft.sku}
                    onChange={(event) => onChange({ ...draft, sku: event.target.value })}
                    className={`${inputClass} w-full`}
                  />
                </Field>
                <Field label="Status">
                  <select
                    value={draft.status}
                    onChange={(event) =>
                      onChange({ ...draft, status: event.target.value as ProductStatus })
                    }
                    className={`${inputClass} w-full`}
                  >
                    <option value="ativo">Ativo</option>
                    <option value="rascunho">Rascunho</option>
                    <option value="arquivado">Arquivado</option>
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Categoria">
                  <select
                    value={draft.category}
                    onChange={(event) =>
                      onChange({ ...draft, category: event.target.value as ProductCategory })
                    }
                    className={`${inputClass} w-full`}
                  >
                    {CATEGORIES.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Configuração">
                  <select
                    value={draft.config}
                    onChange={(event) =>
                      onChange({ ...draft, config: event.target.value as ProductConfig })
                    }
                    className={`${inputClass} w-full`}
                  >
                    {CONFIGS.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Dimensão">
                  <input
                    value={draft.dimensions}
                    onChange={(event) => onChange({ ...draft, dimensions: event.target.value })}
                    className={`${inputClass} w-full`}
                  />
                </Field>
                <Field label="Proporção">
                  <input
                    value={draft.proportion ?? ''}
                    onChange={(event) => onChange({ ...draft, proportion: event.target.value })}
                    className={`${inputClass} w-full`}
                  />
                </Field>
              </div>
              <Field label="Área de impressão">
                <input
                  value={draft.printArea}
                  onChange={(event) => onChange({ ...draft, printArea: event.target.value })}
                  className={`${inputClass} w-full`}
                />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Templates">
                  <input
                    type="number"
                    min={0}
                    value={draft.templateCount}
                    onChange={(event) =>
                      onChange({ ...draft, templateCount: Number(event.target.value) })
                    }
                    className={`${inputClass} w-full`}
                  />
                </Field>
                <Field label="Custo">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={draft.cost}
                    onChange={(event) => onChange({ ...draft, cost: Number(event.target.value) })}
                    className={`${inputClass} w-full`}
                  />
                </Field>
                <Field label="Preço">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={draft.price}
                    onChange={(event) => onChange({ ...draft, price: Number(event.target.value) })}
                    className={`${inputClass} w-full`}
                  />
                </Field>
              </div>
              <Field label="Resumo">
                <textarea
                  value={draft.summary}
                  onChange={(event) => onChange({ ...draft, summary: event.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-[#E4EAF1] bg-white px-3 py-2 text-[12.5px] text-[#0F1E36] outline-none focus:border-[#C5D0DE] resize-none"
                />
              </Field>
              <label className="flex items-center gap-2 text-[12.5px] text-[#334155]">
                <input
                  type="checkbox"
                  checked={draft.hasImage}
                  onChange={(event) => onChange({ ...draft, hasImage: event.target.checked })}
                />
                Produto com imagem
              </label>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12.5px] text-[#5A6B82]">{draft.category}</p>
                <StatusBadge status={draft.status} />
              </div>
              <p className="text-[13px] text-[#334155] leading-relaxed">{draft.summary}</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[12.5px]">
                <Detail label="SKU" value={draft.sku} />
                <Detail label="Configuração" value={draft.config} />
                <Detail label="Dimensão" value={draft.dimensions} />
                <Detail label="Proporção" value={draft.proportion || '—'} />
                <Detail label="Área de impressão" value={draft.printArea} />
                <Detail label="Template" value={draft.templateName} />
                <Detail label="Templates" value={String(draft.templateCount)} />
                <Detail label="Produção" value={`${draft.productionHours} h`} />
                <Detail label="Custo" value={formatBRL(draft.cost)} />
                <Detail label="Preço de venda" value={formatBRL(draft.price)} />
              </dl>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-[#EEF2F7] px-5 py-3 flex items-center justify-end gap-2">
          {editing ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px] text-[#334155]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={!draft.name.trim()}
                className="h-9 px-3.5 rounded-lg bg-[#071A34] text-white text-[12.5px] font-medium disabled:opacity-40"
              >
                Salvar produto
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onDuplicate}
                className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px] text-[#334155]"
              >
                Duplicar
              </button>
              <button
                type="button"
                onClick={onArchive}
                className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px] text-[#334155]"
              >
                {draft.status === 'arquivado' ? 'Reativar' : 'Arquivar'}
              </button>
              <button
                type="button"
                onClick={onEdit}
                className="h-9 px-3.5 rounded-lg bg-[#071A34] text-white text-[12.5px] font-medium"
              >
                Editar
              </button>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-[#5A6B82] mb-1">{label}</span>
      {children}
    </label>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-[#8A98AB]">{label}</dt>
      <dd className="text-[#0F1E36] truncate">{value}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: ProductStatus }) {
  const styles: Record<ProductStatus, string> = {
    ativo: 'bg-emerald-50 text-emerald-700',
    rascunho: 'bg-[#F3F6FA] text-[#5A6B82]',
    arquivado: 'bg-amber-50 text-amber-800',
  };
  return (
    <span className={`inline-flex h-6 items-center px-2 rounded-full text-[11px] font-medium ${styles[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function ProductThumb({ product, className }: { product: ProductRecord; className?: string }) {
  if (!product.hasImage) {
    return (
      <div className={`bg-[#F3F6FA] text-[#8A98AB] flex flex-col items-center justify-center ${className ?? ''}`}>
        <ImageOff className="w-5 h-5" />
        <span className="text-[11px] mt-1">Sem imagem</span>
      </div>
    );
  }

  return (
    <div className={`bg-[#F4F7FB] overflow-hidden ${className ?? ''}`} style={{ color: product.tone }}>
      <svg viewBox="0 0 320 180" className="w-full h-full" aria-hidden>
        <rect width="320" height="180" fill="#F4F7FB" />
        {product.category === 'Uniformes' ? (
          <>
            <path d="M118 42 L160 58 L202 42 L228 62 L206 78 L196 150 L124 150 L114 78 L92 62 Z" fill="currentColor" opacity="0.9" />
            <path d="M146 58 H174 L168 78 H152 Z" fill="#F4F7FB" />
            <rect x="148" y="96" width="24" height="8" rx="2" fill="#E3C16F" />
          </>
        ) : product.category === 'Personalização' ? (
          <>
            <path d="M126 38 H188 C206 38 214 54 214 72 V146 H100 V72 C100 54 108 38 126 38 Z" fill="#FFFFFF" stroke="currentColor" strokeWidth="8" />
            <rect x="118" y="78" width="84" height="36" rx="6" fill="currentColor" opacity="0.18" />
            <ellipse cx="160" cy="38" rx="28" ry="8" fill="currentColor" opacity="0.35" />
          </>
        ) : product.category === 'Comunicação visual' ? (
          <>
            <rect x="118" y="24" width="84" height="132" rx="4" fill="currentColor" />
            <rect x="132" y="42" width="56" height="8" rx="2" fill="#F6F8FB" />
            <rect x="132" y="58" width="40" height="6" rx="2" fill="#E3C16F" />
            <rect x="154" y="156" width="12" height="10" fill="#C5D0DE" />
          </>
        ) : product.category === 'Personalização a laser' ? (
          <>
            <rect x="78" y="46" width="164" height="96" rx="6" fill="#FFFFFF" stroke="currentColor" strokeWidth="6" />
            <path d="M98 78 H188 M98 96 H168 M98 114 H150" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
            <circle cx="214" cy="112" r="10" fill="#E3C16F" />
          </>
        ) : product.category === 'Outros' ? (
          <>
            <path d="M104 58 H216 L204 142 H116 Z" fill="currentColor" opacity="0.88" />
            <path d="M128 58 V46 H192 V58" fill="none" stroke="currentColor" strokeWidth="8" />
            <rect x="136" y="86" width="48" height="8" rx="2" fill="#E3C16F" />
          </>
        ) : (
          <>
            <rect x="58" y="52" width="204" height="86" rx="8" fill="#FFFFFF" stroke="#E4EAF1" />
            <rect x="76" y="70" width="92" height="10" rx="5" fill="currentColor" />
            <rect x="76" y="90" width="140" height="6" rx="3" fill="#D5DEE8" />
            <rect x="76" y="104" width="104" height="6" rx="3" fill="#D5DEE8" />
            <rect x="214" y="96" width="28" height="18" rx="3" fill="#E3C16F" />
          </>
        )}
      </svg>
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
        <Package className="w-5 h-5" />
      </div>
      <h3 className="mt-3 text-[14px] font-semibold text-[#071A34]">{title}</h3>
      <p className="mt-1 text-[12.5px] text-[#5A6B82] max-w-sm">{text}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 h-9 px-3.5 rounded-lg bg-[#071A34] text-white text-[12.5px] font-medium inline-flex items-center gap-1.5"
        >
          {actionLabel.startsWith('Adicionar') && <Plus className="w-3.5 h-3.5 text-[#E3C16F]" />}
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function ProductSkeleton({ view }: { view: ViewMode }) {
  if (view === 'list') {
    return (
      <div className="bg-white border border-[#E4EAF1] rounded-lg divide-y divide-[#F1F5F9]">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-14 px-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-md bg-[#F3F6FA] animate-pulse" />
            <div className="h-3 w-48 rounded bg-[#F3F6FA] animate-pulse" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="bg-white border border-[#E4EAF1] rounded-lg overflow-hidden">
          <div className="h-[148px] bg-[#E7EDF4] animate-pulse" />
          <div className="p-3.5 space-y-2">
            <div className="h-3 w-3/4 rounded bg-[#E7EDF4] animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-[#E7EDF4] animate-pulse" />
            <div className="h-3 w-2/3 rounded bg-[#E7EDF4] animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

function blankProduct(): ProductRecord {
  return {
    id: `prd-${Date.now()}`,
    sku: '',
    name: '',
    category: 'Impressão gráfica',
    templateName: 'novo-template.svg',
    templateCount: 1,
    dimensions: '',
    proportion: '',
    printArea: '',
    cost: 0,
    price: 0,
    productionHours: 1,
    active: true,
    status: 'rascunho',
    config: 'Template',
    summary: '',
    hasImage: true,
    tone: '#1E3A5F',
  };
}
