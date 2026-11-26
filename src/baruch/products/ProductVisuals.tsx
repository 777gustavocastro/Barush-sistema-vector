import { ImageOff } from 'lucide-react';
import type { CatalogProduct } from './catalogTypes';

export function ProductThumb({
  product,
  className,
}: {
  product: Pick<CatalogProduct, 'name' | 'category' | 'image'>;
  className?: string;
}) {
  if (product.image) {
    return (
      <img
        src={product.image.dataUrl}
        alt={product.name}
        className={`object-contain bg-[#F6F8FB] ${className ?? ''}`}
      />
    );
  }

  return (
    <div className={`bg-[#F4F7FB] overflow-hidden text-[#1E3A5F] ${className ?? ''}`}>
      <svg viewBox="0 0 320 180" className="w-full h-full" aria-hidden>
        <rect width="320" height="180" fill="#F4F7FB" />
        <ThumbShape category={product.category} />
      </svg>
    </div>
  );
}

export function EmptyThumb({ className }: { className?: string }) {
  return (
    <div className={`bg-[#F3F6FA] text-[#8A98AB] flex flex-col items-center justify-center ${className ?? ''}`}>
      <ImageOff className="w-5 h-5" />
      <span className="text-[11px] mt-1">Sem imagem</span>
    </div>
  );
}

function ThumbShape({ category }: { category: CatalogProduct['category'] }) {
  if (category === 'Uniformes') {
    return (
      <path d="M118 42 L160 58 L202 42 L228 62 L206 78 L196 150 L124 150 L114 78 L92 62 Z" fill="currentColor" opacity="0.9" />
    );
  }
  if (category === 'Personalização') {
    return (
      <path d="M126 38 H188 C206 38 214 54 214 72 V146 H100 V72 C100 54 108 38 126 38 Z" fill="#FFFFFF" stroke="currentColor" strokeWidth="8" />
    );
  }
  if (category === 'Comunicação visual') {
    return <rect x="118" y="24" width="84" height="132" rx="4" fill="currentColor" />;
  }
  if (category === 'Personalização a laser') {
    return <rect x="78" y="46" width="164" height="96" rx="6" fill="#FFFFFF" stroke="currentColor" strokeWidth="6" />;
  }
  if (category === 'Outros') {
    return <path d="M104 58 H216 L204 142 H116 Z" fill="currentColor" opacity="0.88" />;
  }
  return <rect x="58" y="52" width="204" height="86" rx="8" fill="#FFFFFF" stroke="#E4EAF1" />;
}
