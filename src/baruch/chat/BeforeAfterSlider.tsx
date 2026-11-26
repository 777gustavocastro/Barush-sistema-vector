import { MoveHorizontal } from 'lucide-react';
import { useRef, useState } from 'react';
import { RealSvgViewport } from '../../components/RealSvgViewport';

interface BeforeAfterSliderProps {
  beforeUrl: string;
  afterImageUrl?: string;
  afterSvgMarkup?: string;
  beforeLabel?: string;
  afterLabel?: string;
  aspectClassName?: string;
}

/**
 * Comparador deslizante horizontal (antes e depois) reutilizando o RealSvgViewport
 * para vetorizações reais ou imagens processadas no chat.
 */
export function BeforeAfterSlider({
  beforeUrl,
  afterImageUrl,
  afterSvgMarkup,
  beforeLabel = 'Original',
  afterLabel = 'Resultado',
  aspectClassName = 'h-[300px] sm:h-[340px]',
}: BeforeAfterSliderProps) {
  const [split, setSplit] = useState(50);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const updateSplit = (clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((clientX - rect.left) / Math.max(1, rect.width)) * 100;
    setSplit(Math.max(4, Math.min(96, pct)));
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={(e) => {
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
        updateSplit(e.clientX);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        updateSplit(e.clientX);
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      className={`relative w-full ${aspectClassName} rounded-lg overflow-hidden border border-[#E4EAF1] bg-[linear-gradient(45deg,#F1F5F9_25%,transparent_25%,transparent_75%,#F1F5F9_75%,#F1F5F9),linear-gradient(45deg,#F1F5F9_25%,transparent_25%,transparent_75%,#F1F5F9_75%,#F1F5F9)] bg-[length:16px_16px] bg-[position:0_0,8px_8px] bg-white select-none touch-none cursor-ew-resize`}
      role="slider"
      aria-label="Comparador antes e depois"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(split)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') setSplit((v) => Math.max(4, v - 5));
        if (e.key === 'ArrowRight') setSplit((v) => Math.min(96, v + 5));
      }}
    >
      {/* Camada "Depois" (fundo completo) */}
      <div className="absolute inset-0 flex items-center justify-center p-3">
        {afterSvgMarkup ? (
          <RealSvgViewport svgMarkup={afterSvgMarkup} className="w-full h-full" />
        ) : afterImageUrl ? (
          <img
            src={afterImageUrl}
            alt={afterLabel}
            draggable={false}
            className="max-w-full max-h-full object-contain pointer-events-none"
          />
        ) : null}
      </div>

      {/* Camada "Antes" (recortada à esquerda pelo divisor) */}
      <div
        className="absolute inset-0 flex items-center justify-center p-3 bg-white/90"
        style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
      >
        <img
          src={beforeUrl}
          alt={beforeLabel}
          draggable={false}
          className="max-w-full max-h-full object-contain pointer-events-none"
        />
      </div>

      {/* Linha divisória e pegador */}
      <div
        className="absolute top-0 bottom-0 w-px bg-[#071A34]/75 pointer-events-none"
        style={{ left: `${split}%` }}
      >
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-[#071A34] text-[#E3C16F] shadow-md border border-white/80 flex items-center justify-center">
          <MoveHorizontal className="w-3.5 h-3.5" strokeWidth={2} />
        </div>
      </div>

      {/* Rótulos discretos */}
      <span className="pointer-events-none absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-white/90 border border-[#E4EAF1] text-[11px] font-medium text-[#071A34]">
        {beforeLabel}
      </span>
      <span className="pointer-events-none absolute top-2.5 right-2.5 px-2 py-0.5 rounded bg-[#071A34]/90 text-[11px] font-medium text-white">
        {afterLabel}
      </span>
    </div>
  );
}
