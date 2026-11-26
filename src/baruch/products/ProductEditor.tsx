import { Plus, Trash2, X } from 'lucide-react';
import { SelectMenu } from '../components/SelectMenu';
import type { ReactNode } from 'react';
import type { CatalogFieldErrors } from './catalogValidation';
import { emptyTemplate } from './catalogValidation';
import { readCatalogImage } from './catalogImages';
import { formatMoney, formatTemplateSize } from './catalogApi';
import {
  MEASURE_UNITS,
  ORIENTATIONS,
  PRODUCT_CATEGORIES,
  SALE_UNITS,
  type CatalogProduct,
  type MeasureUnit,
  type ProductTemplate,
  type SaleUnit,
  type TemplateOrientation,
} from './catalogTypes';
import { ProductThumb } from './ProductVisuals';

const fieldClass =
  'h-9 w-full rounded-lg border border-[#E4EAF1] bg-white px-3 text-[12.5px] text-[#0F1E36] outline-none focus:border-[#C5D0DE]';

interface ProductEditorProps {
  mode: 'view' | 'edit' | 'create';
  draft: CatalogProduct;
  errors: CatalogFieldErrors;
  saving: boolean;
  onChange: (next: CatalogProduct) => void;
  onClose: () => void;
  onEdit: () => void;
  onSave: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onAskDelete: () => void;
}

export function ProductEditor({
  mode,
  draft,
  errors,
  saving,
  onChange,
  onClose,
  onEdit,
  onSave,
  onDuplicate,
  onArchive,
  onAskDelete,
}: ProductEditorProps) {
  const editing = mode !== 'view';
  const title =
    mode === 'view' ? draft.name : mode === 'edit' ? 'Editar produto' : draft.name.trim() || 'Novo produto';

  const updateTemplate = (id: string, patch: Partial<ProductTemplate>) => {
    onChange({
      ...draft,
      templates: draft.templates.map((template) =>
        template.id === id ? { ...template, ...patch } : template
      ),
    });
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Fechar painel" className="absolute inset-0 bg-[#071A34]/20" onClick={onClose} />
      <aside className="relative h-full w-full max-w-[720px] bg-white border-l border-[#E4EAF1] shadow-xl flex flex-col">
        <div className="border-b border-[#EEF2F7] px-5 py-3.5 flex items-center justify-between gap-3">
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

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {editing ? (
            <>
              <Section title="Informações gerais">
                <Field label="Nome" error={errors.name}>
                  <input
                    value={draft.name}
                    onChange={(event) => onChange({ ...draft, name: event.target.value })}
                    className={fieldClass}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Categoria">
                    <SelectMenu
                      value={draft.category}
                      ariaLabel="Categoria do produto"
                      className="w-full max-w-none"
                      onChange={(category) => onChange({ ...draft, category })}
                      options={PRODUCT_CATEGORIES.map((category) => ({ value: category, label: category }))}
                    />
                  </Field>
                  <Field label="Status">
                    <SelectMenu
                      value={draft.status}
                      ariaLabel="Status do produto"
                      className="w-full max-w-none"
                      onChange={(status) => onChange({ ...draft, status })}
                      options={[
                        { value: 'ativo', label: 'Ativo' },
                        { value: 'arquivado', label: 'Arquivado' },
                      ]}
                    />
                  </Field>
                </div>
                <Field label="Descrição">
                  <textarea
                    value={draft.description}
                    onChange={(event) => onChange({ ...draft, description: event.target.value })}
                    rows={2}
                    className="w-full rounded-lg border border-[#E4EAF1] px-3 py-2 text-[12.5px] text-[#0F1E36] outline-none focus:border-[#C5D0DE] resize-none"
                  />
                </Field>
                <ImageFields draft={draft} onChange={onChange} />
              </Section>

              <Section title="Informações comerciais">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Custo unitário" error={errors.cost}>
                    <input
                      inputMode="decimal"
                      value={moneyInput(draft.cost)}
                      onChange={(event) => onChange({ ...draft, cost: parseMoney(event.target.value) })}
                      placeholder="Opcional"
                      className={fieldClass}
                    />
                  </Field>
                  <Field label="Unidade de custo">
                    <UnitSelect
                      value={draft.costUnit}
                      onChange={(costUnit) => onChange({ ...draft, costUnit })}
                    />
                  </Field>
                  <Field label="Preço de venda" error={errors.price}>
                    <input
                      inputMode="decimal"
                      value={moneyInput(draft.price)}
                      onChange={(event) => onChange({ ...draft, price: parseMoney(event.target.value) })}
                      placeholder="Opcional, se o preço variar"
                      className={fieldClass}
                    />
                  </Field>
                  <Field label="Unidade de venda">
                    <UnitSelect
                      value={draft.saleUnit}
                      onChange={(saleUnit) => onChange({ ...draft, saleUnit })}
                    />
                  </Field>
                </div>
                <Field label="Observações comerciais">
                  <textarea
                    value={draft.commercialNotes}
                    onChange={(event) => onChange({ ...draft, commercialNotes: event.target.value })}
                    rows={2}
                    className="w-full rounded-lg border border-[#E4EAF1] px-3 py-2 text-[12.5px] outline-none focus:border-[#C5D0DE] resize-none"
                  />
                </Field>
                <Field label="Observação sobre o custo">
                  <input
                    value={draft.costNote}
                    onChange={(event) => onChange({ ...draft, costNote: event.target.value })}
                    className={fieldClass}
                  />
                </Field>
              </Section>

              <Section
                title="Templates e formatos"
                action={
                  <button
                    type="button"
                    onClick={() =>
                      onChange({ ...draft, templates: [...draft.templates, emptyTemplate(`Template ${draft.templates.length + 1}`)] })
                    }
                    className="h-7 px-2 rounded-md text-[12px] text-[#071A34] hover:bg-[#F3F6FA] inline-flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Adicionar template
                  </button>
                }
              >
                {draft.templates.length === 0 ? (
                  <p className="text-[12.5px] text-[#5A6B82]">
                    Nenhum template. Adicione apenas os formatos que este produto realmente usa.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {draft.templates.map((template, index) => (
                      <TemplateFields
                        key={template.id}
                        index={index}
                        template={template}
                        errors={errors.templates?.[template.id]}
                        onChange={(patch) => updateTemplate(template.id, patch)}
                        onRemove={() =>
                          onChange({
                            ...draft,
                            templates: draft.templates.filter((item) => item.id !== template.id),
                          })
                        }
                      />
                    ))}
                  </div>
                )}
              </Section>
            </>
          ) : (
            <ProductDetails draft={draft} />
          )}
        </div>

        <div className="border-t border-[#EEF2F7] px-5 py-3 flex items-center justify-end gap-2">
          {editing ? (
            <>
              <button type="button" onClick={onClose} className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px] text-[#334155]">
                Cancelar
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={saving}
                className="h-9 px-3.5 rounded-lg bg-[#071A34] text-white text-[12.5px] font-medium disabled:opacity-40"
              >
                {saving ? 'Salvando…' : 'Salvar produto'}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onDuplicate} className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px] text-[#334155]">
                Duplicar
              </button>
              <button type="button" onClick={onArchive} className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px] text-[#334155]">
                {draft.status === 'arquivado' ? 'Reativar' : 'Arquivar'}
              </button>
              <button type="button" onClick={onAskDelete} className="h-9 px-3 rounded-lg border border-[#E4EAF1] text-[12.5px] text-rose-700">
                Excluir
              </button>
              <button type="button" onClick={onEdit} className="h-9 px-3.5 rounded-lg bg-[#071A34] text-white text-[12.5px] font-medium">
                Editar
              </button>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function ProductDetails({ draft }: { draft: CatalogProduct }) {
  return (
    <div className="space-y-5">
      <ProductThumb product={draft} className="h-40 w-full rounded-lg" />
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-[#5A6B82]">{draft.category}</p>
        <StatusPill status={draft.status} />
      </div>
      {draft.description && <p className="text-[13px] text-[#334155] leading-relaxed">{draft.description}</p>}
      {draft.gallery.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {draft.gallery.map((image) => (
            <img key={image.id} src={image.dataUrl} alt={image.name} className="h-16 w-16 rounded-md object-cover border border-[#E4EAF1]" />
          ))}
        </div>
      )}

      <Section title="Comercial">
        <dl className="grid grid-cols-2 gap-3 text-[12.5px]">
          <Detail label="Custo" value={draft.cost === null ? 'Não informado' : `${formatMoney(draft.cost)} / ${draft.costUnit}`} />
          <Detail label="Preço de venda" value={draft.price === null ? 'Variável' : `${formatMoney(draft.price)} / ${draft.saleUnit}`} />
          <Detail label="Unidade de venda" value={draft.saleUnit} />
          {draft.costNote && <Detail label="Observação do custo" value={draft.costNote} />}
          {draft.commercialNotes && <Detail label="Observações" value={draft.commercialNotes} />}
        </dl>
      </Section>

      <Section title={`Templates (${draft.templates.length})`}>
        {draft.templates.length === 0 ? (
          <p className="text-[12.5px] text-[#5A6B82]">Nenhum template cadastrado.</p>
        ) : (
          <div className="space-y-2.5">
            {draft.templates.map((template) => (
              <article key={template.id} className="rounded-lg border border-[#E4EAF1] p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-[13px] font-medium text-[#071A34]">{template.name}</h4>
                    <p className="text-[12px] text-[#5A6B82]">{formatTemplateSize(template) || 'Sem dimensão'}</p>
                  </div>
                  {template.referenceImage && (
                    <img src={template.referenceImage.dataUrl} alt="" className="h-12 w-12 rounded-md object-cover" />
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
                  {template.proportion && <Detail label="Proporção" value={template.proportion} />}
                  {template.printArea && <Detail label="Área útil" value={template.printArea} />}
                  {template.safeArea && <Detail label="Área segura" value={template.safeArea} />}
                  {template.bleed && <Detail label="Sangria" value={template.bleed} />}
                  {template.orientation && <Detail label="Orientação" value={template.orientation} />}
                  {template.formatNotes && <Detail label="Formato" value={template.formatNotes} />}
                  {template.contourNote && <Detail label="Contorno" value={template.contourNote} />}
                  {template.technicalNotes && <Detail label="Observações" value={template.technicalNotes} />}
                </dl>
              </article>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function TemplateFields({
  index,
  template,
  errors,
  onChange,
  onRemove,
}: {
  index: number;
  template: ProductTemplate;
  errors?: { name?: string; width?: string; height?: string };
  onChange: (patch: Partial<ProductTemplate>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-[#E4EAF1] p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-[#071A34]">Template {index + 1}</span>
        <button type="button" onClick={onRemove} className="h-7 px-2 text-[12px] text-rose-700 inline-flex items-center gap-1">
          <Trash2 className="w-3.5 h-3.5" />
          Remover
        </button>
      </div>
      <Field label="Nome" error={errors?.name}>
        <input value={template.name} onChange={(event) => onChange({ name: event.target.value })} className={fieldClass} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Largura" error={errors?.width}>
          <input
            inputMode="decimal"
            value={template.width ?? ''}
            onChange={(event) => onChange({ width: parseDimension(event.target.value) })}
            className={fieldClass}
          />
        </Field>
        <Field label="Altura" error={errors?.height}>
          <input
            inputMode="decimal"
            value={template.height ?? ''}
            onChange={(event) => onChange({ height: parseDimension(event.target.value) })}
            className={fieldClass}
          />
        </Field>
        <Field label="Unidade">
          <SelectMenu
            value={template.unit || 'mm'}
            ariaLabel="Unidade de medida"
            className="w-full max-w-none"
            onChange={(unit) => onChange({ unit: unit as MeasureUnit })}
            options={MEASURE_UNITS.map((unit) => ({ value: unit, label: unit }))}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dimensão física">
          <input value={template.physicalSize} onChange={(event) => onChange({ physicalSize: event.target.value })} className={fieldClass} />
        </Field>
        <Field label="Proporção">
          <input value={template.proportion} onChange={(event) => onChange({ proportion: event.target.value })} placeholder="1:1, 9:16, A4" className={fieldClass} />
        </Field>
        <Field label="Área útil de impressão">
          <input value={template.printArea} onChange={(event) => onChange({ printArea: event.target.value })} className={fieldClass} />
        </Field>
        <Field label="Área segura">
          <input value={template.safeArea} onChange={(event) => onChange({ safeArea: event.target.value })} className={fieldClass} />
        </Field>
        <Field label="Sangria">
          <input value={template.bleed} onChange={(event) => onChange({ bleed: event.target.value })} className={fieldClass} />
        </Field>
        <Field label="Orientação">
          <SelectMenu
            value={template.orientation || 'nenhuma'}
            ariaLabel="Orientação do template"
            className="w-full max-w-none"
            onChange={(orientation) =>
              onChange({ orientation: orientation === 'nenhuma' ? '' : (orientation as TemplateOrientation) })
            }
            options={[
              { value: 'nenhuma', label: 'Não definida' },
              ...ORIENTATIONS.map((item) => ({ value: item, label: item })),
            ]}
          />
        </Field>
      </div>
      <Field label="Configuração do formato">
        <input value={template.formatNotes} onChange={(event) => onChange({ formatNotes: event.target.value })} className={fieldClass} />
      </Field>
      <Field label="Referência do contorno">
        <input value={template.contourNote} onChange={(event) => onChange({ contourNote: event.target.value })} className={fieldClass} />
      </Field>
      <Field label="Observações técnicas">
        <textarea
          value={template.technicalNotes}
          onChange={(event) => onChange({ technicalNotes: event.target.value })}
          rows={2}
          className="w-full rounded-lg border border-[#E4EAF1] px-3 py-2 text-[12.5px] outline-none focus:border-[#C5D0DE] resize-none"
        />
      </Field>
      <label className="block text-[12px] text-[#5A6B82]">
        Imagem de referência
        <input
          type="file"
          accept="image/*"
          className="mt-1 block w-full text-[12px]"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            void readCatalogImage(file).then((image) => onChange({ referenceImage: image }));
          }}
        />
      </label>
      {template.referenceImage && (
        <img src={template.referenceImage.dataUrl} alt="" className="h-16 w-16 rounded-md object-cover" />
      )}
    </div>
  );
}

function ImageFields({
  draft,
  onChange,
}: {
  draft: CatalogProduct;
  onChange: (next: CatalogProduct) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <ProductThumb product={draft} className="h-16 w-24 rounded-md" />
        <label className="text-[12px] text-[#5A6B82]">
          Imagem principal
          <input
            type="file"
            accept="image/*"
            className="mt-1 block text-[12px] text-[#0F1E36]"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              void readCatalogImage(file)
                .then((image) => onChange({ ...draft, image }))
                .catch(() => undefined);
            }}
          />
        </label>
      </div>
      <label className="block text-[12px] text-[#5A6B82]">
        Imagens adicionais
        <input
          type="file"
          accept="image/*"
          multiple
          className="mt-1 block w-full text-[12px] text-[#0F1E36]"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            if (files.length === 0) return;
            void Promise.all(files.map((file) => readCatalogImage(file))).then((images) =>
              onChange({ ...draft, gallery: [...draft.gallery, ...images] })
            );
          }}
        />
      </label>
      {draft.gallery.length > 0 && (
        <div className="flex gap-2">
          {draft.gallery.map((image) => (
            <button
              key={image.id}
              type="button"
              onClick={() => onChange({ ...draft, gallery: draft.gallery.filter((item) => item.id !== image.id) })}
              className="relative"
              title="Remover referência"
            >
              <img src={image.dataUrl} alt={image.name} className="h-12 w-12 rounded-md object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UnitSelect({ value, onChange }: { value: SaleUnit; onChange: (unit: SaleUnit) => void }) {
  return (
    <SelectMenu
      value={value}
      ariaLabel="Unidade"
      className="w-full max-w-none"
      onChange={onChange}
      options={SALE_UNITS.map((unit) => ({ value: unit, label: unit }))}
    />
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[12px] font-semibold uppercase tracking-[0.05em] text-[#5A6B82]">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-[#5A6B82] mb-1">{label}</span>
      {children}
      {error && <span className="block mt-1 text-[11.5px] text-rose-700">{error}</span>}
    </label>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-[#8A98AB]">{label}</dt>
      <dd className="text-[#0F1E36]">{value}</dd>
    </div>
  );
}

export function StatusPill({ status }: { status: CatalogProduct['status'] }) {
  const active = status === 'ativo';
  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 px-2 rounded-full text-[11px] font-medium ${
        active ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {active ? 'Ativo' : 'Arquivado'}
    </span>
  );
}

function moneyInput(value: number | null): string {
  return value === null ? '' : String(value);
}

function parseMoney(value: string): number | null {
  const trimmed = value.trim().replace(',', '.');
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseDimension(value: string): number | null {
  const trimmed = value.trim().replace(',', '.');
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
