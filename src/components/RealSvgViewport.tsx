import React, { useEffect, useRef } from 'react';

interface RealSvgViewportProps {
  svgMarkup: string;
  highlightPaths?: boolean;
  className?: string;
}

/**
 * Renderiza o documento SVG vetorial real diretamente na árvore DOM (sem rasterizar em PNG),
 * higienizando scripts ou atributos de evento e mantendo todos os elementos <path> vetoriais vivos.
 */
export const RealSvgViewport: React.FC<RealSvgViewportProps> = ({
  svgMarkup,
  highlightPaths = false,
  className = '',
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;

    if (!svgMarkup.trim()) {
      container.replaceChildren();
      return;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(svgMarkup, 'image/svg+xml');
    const parseError = doc.querySelector('parsererror');
    const svgEl = doc.documentElement;

    if (parseError || !svgEl || svgEl.tagName.toLowerCase() !== 'svg') {
      container.replaceChildren();
      return;
    }

    // Defesa em profundidade: garante remoção de elementos/atributos executáveis
    svgEl.querySelectorAll('script, foreignObject, iframe, object, embed').forEach((node) => {
      node.remove();
    });

    svgEl.querySelectorAll('*').forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || attr.value.trim().toLowerCase().startsWith('javascript:')) {
          el.removeAttribute(attr.name);
        }
      }
    });

    svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const importedSvg = document.importNode(svgEl, true);
    container.replaceChildren(importedSvg);
  }, [svgMarkup]);

  return (
    <div
      ref={hostRef}
      data-testid="real-svg-viewport"
      className={`real-svg-host w-full h-full select-none ${
        highlightPaths ? 'vector-wireframe' : ''
      } ${className}`}
    />
  );
};
