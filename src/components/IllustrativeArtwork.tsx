import React from 'react';

interface IllustrativeArtworkProps {
  variant: 'raster' | 'vector';
  customImageUrl?: string | null;
  showVectorNodes?: boolean;
}

/**
 * Componente puramente ilustrativo para composição visual do protótipo (Etapa 1).
 * Exibe uma arte demonstrativa claramente identificada quando não há motor real conectado.
 */
export const IllustrativeArtwork: React.FC<IllustrativeArtworkProps> = ({
  variant,
  customImageUrl,
  showVectorNodes = false,
}) => {
  if (variant === 'raster' && customImageUrl) {
    return (
      <div className="relative flex items-center justify-center w-full h-full p-4 select-none">
        <img
          src={customImageUrl}
          alt="Imagem original enviada pelo usuário"
          className="max-w-full max-h-[340px] w-auto h-auto object-contain rounded-md shadow-sm"
          draggable={false}
        />
      </div>
    );
  }

  const isRaster = variant === 'raster';

  return (
    <div className="relative flex flex-col items-center justify-center w-full h-full p-6 select-none">
      <div
        className={`relative w-56 h-56 sm:w-64 sm:h-64 flex items-center justify-center transition-all ${
          isRaster ? 'contrast-95 saturate-90' : ''
        }`}
      >
        <svg
          viewBox="0 0 240 240"
          className="w-full h-full overflow-visible"
          style={
            isRaster
              ? {
                  filter: 'blur(0.45px) contrast(0.96)',
                  imageRendering: 'pixelated',
                }
              : undefined
          }
          aria-label={
            isRaster
              ? 'Composição ilustrativa representando imagem bitmap original'
              : 'Composição ilustrativa representando traçado vetorial no protótipo'
          }
        >
          <defs>
            <linearGradient id={`grad-primary-${variant}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#8b5cf6" />
            </linearGradient>
            <linearGradient id={`grad-accent-${variant}`} x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#06b6d4" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
            <linearGradient id={`grad-warm-${variant}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#f97316" />
            </linearGradient>
          </defs>

          {/* Base hexagonal suave */}
          <path
            d="M120 22 L202 69 L202 171 L120 218 L38 171 L38 69 Z"
            fill={`url(#grad-primary-${variant})`}
            fillOpacity={isRaster ? '0.16' : '0.18'}
            stroke="#6366f1"
            strokeWidth={isRaster ? '2.5' : '2'}
            strokeOpacity="0.45"
          />

          {/* Forma fluida central */}
          <path
            d="M64 152 C64 96, 106 56, 162 62 C158 118, 126 168, 64 152 Z"
            fill={`url(#grad-primary-${variant})`}
          />

          {/* Arco secundário ciano */}
          <path
            d="M84 176 C128 182, 174 148, 178 96 C152 126, 118 148, 84 176 Z"
            fill={`url(#grad-accent-${variant})`}
          />

          {/* Elemento focal circular */}
          <circle cx="96" cy="92" r="20" fill={`url(#grad-warm-${variant})`} />

          {/* Sobreposição sutil de malha de pixels apenas na variante raster ilustrativa */}
          {isRaster && (
            <g opacity="0.22">
              {Array.from({ length: 11 }).map((_, idx) => {
                const pos = 40 + idx * 16;
                return (
                  <React.Fragment key={pos}>
                    <line
                      x1={pos}
                      y1="36"
                      x2={pos}
                      y2="204"
                      stroke="#71717a"
                      strokeWidth="0.6"
                      strokeDasharray="2 2"
                    />
                    <line
                      x1="36"
                      y1={pos}
                      x2="204"
                      y2={pos}
                      stroke="#71717a"
                      strokeWidth="0.6"
                      strokeDasharray="2 2"
                    />
                  </React.Fragment>
                );
              })}
            </g>
          )}

          {/* Nós e alças Bézier ilustrativos na variante vetorial */}
          {!isRaster && showVectorNodes && (
            <g>
              <path
                d="M64 152 C64 96, 106 56, 162 62"
                fill="none"
                stroke="#a5b4fc"
                strokeWidth="1.25"
                strokeDasharray="3 3"
              />
              <line x1="64" y1="152" x2="64" y2="108" stroke="#38bdf8" strokeWidth="1.2" />
              <circle cx="64" cy="108" r="3" fill="#09090b" stroke="#38bdf8" strokeWidth="1.5" />
              <line x1="162" y1="62" x2="122" y2="58" stroke="#38bdf8" strokeWidth="1.2" />
              <circle cx="122" cy="58" r="3" fill="#09090b" stroke="#38bdf8" strokeWidth="1.5" />

              {[
                [64, 152],
                [162, 62],
                [84, 176],
                [178, 96],
                [96, 72],
                [96, 112],
              ].map(([cx, cy], index) => (
                <rect
                  key={index}
                  x={cx - 3.5}
                  y={cy - 3.5}
                  width="7"
                  height="7"
                  rx="1.5"
                  fill="#ffffff"
                  stroke="#4f46e5"
                  strokeWidth="1.8"
                />
              ))}
            </g>
          )}
        </svg>
      </div>
    </div>
  );
};
