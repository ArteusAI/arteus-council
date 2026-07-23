import { useEffect, useMemo, useState } from 'react';
import './TOCMinimap.css';

/**
 * Port of https://www.syedmoinuddin.com/components/toc-minimap
 * (shadcn registry item `@syedmoin/toc-minimap`) to plain React + CSS.
 *
 * - Compact minimap bars; hovering reveals the full TOC panel.
 * - Active heading tracked via IntersectionObserver.
 * - Clicking a link updates the URL hash and smooth-scrolls.
 */

export function useActiveHeading(itemIds) {
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: '0% 0% -80% 0%', threshold: 0.98 }
    );

    for (const id of itemIds ?? []) {
      const element = document.getElementById(id);
      if (element) {
        observer.observe(element);
      }
    }

    return () => {
      for (const id of itemIds ?? []) {
        const element = document.getElementById(id);
        if (element) {
          observer.unobserve(element);
        }
      }
    };
  }, [itemIds]);

  return activeId;
}

function handleItemClick(e) {
  e.preventDefault();
  const url = e.currentTarget.getAttribute('href') ?? '';
  scrollToHeading(url);
}

function scrollToHeading(url) {
  history.pushState(null, '', url);
  document.getElementById(url.replace('#', ''))?.scrollIntoView({
    behavior: 'smooth',
  });
}

export default function TOCMinimap({ items, className }) {
  const itemIds = useMemo(
    () => items.map((item) => item.url.replace('#', '')),
    [items]
  );

  const activeHeading = useActiveHeading(itemIds);

  if (!items.length) {
    return null;
  }

  return (
    <div className={`toc-minimap ${className || ''}`}>
      {/* Minimap bars (fade out when the panel opens) */}
      <div className="toc-minimap-bars">
        {items.map((item) => (
          <div
            key={item.url}
            data-depth={item.depth}
            data-active={item.url === `#${activeHeading}` ? '' : undefined}
            className="toc-minimap-bar"
          />
        ))}
      </div>

      {/* Expanded TOC panel (revealed on hover) */}
      <div className="toc-minimap-panel">
        <ul>
          {items.map((item) => (
            <li key={item.url}>
              <a
                href={item.url}
                data-depth={item.depth}
                data-active={item.url === `#${activeHeading}` ? '' : undefined}
                onClick={handleItemClick}
              >
                {item.title}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
