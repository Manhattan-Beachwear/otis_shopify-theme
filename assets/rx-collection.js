// Resolve shared RX modules via the versioned import map (see
// snippets/rx-import-map.liquid) — unversioned relative imports would be
// CDN-cached for a year. The relative fallback covers node tests.
function rxImport(name) {
  let map = {};
  if (typeof document !== 'undefined') {
    try {
      map = JSON.parse(document.querySelector('script[data-rx-imports]')?.textContent ?? '{}');
    } catch {
      map = {};
    }
  }
  return import(map[name] ?? new URL(`./${name}`, import.meta.url).href);
}

const { lensColorSlug, stripImageSizeParams } = await rxImport('rx-core.js');
const { recolorLensImage } = await rxImport('rx-api.js');

(function initRxCollection() {
  if (window.__rxCollectionInit) return;
  window.__rxCollectionInit = true;

  const configEl = document.querySelector('[data-rx-collection]');
  if (!configEl) return;

  let config;
  try {
    config = JSON.parse(configEl.textContent);
  } catch {
    return;
  }

  const view = (config.view || '').trim();
  // Coatings are invisible on a photo — all Clear options share one render.
  const rawSlug = lensColorSlug(config.lensColor || '');
  const slug = rawSlug.startsWith('clear') ? 'clear' : rawSlug;

  // Scoped so recommendations and other sections keep their default links and
  // photos. Defaults to the collection grid; pages that show a product-list
  // section point it at that container instead.
  const GRID = (config.scope || '').trim() || '.product-grid-container';

  // --- Card links → alternate product view -----------------------------------

  function rewriteLinks() {
    if (!view) return;
    for (const link of document.querySelectorAll(`${GRID} a[href*="/products/"]`)) {
      const href = link.getAttribute('href');
      if (!href) continue;
      try {
        const url = new URL(href, location.origin);
        if (url.searchParams.get('view')) continue;
        url.searchParams.set('view', view);
        link.setAttribute('href', url.pathname + url.search);
      } catch {
        // malformed href — leave it alone
      }
    }
  }

  // --- Card photos → recolored lens renders ----------------------------------

  function publicImageUrl(src) {
    try {
      const u = new URL(src, location.href);
      const shop = window.Shopify?.shop;
      if (shop && u.pathname.startsWith('/cdn/')) return `https://${shop}${u.pathname}${u.search}`;
      return u.href;
    } catch {
      return src;
    }
  }

  function isShopImage(src) {
    try {
      return new URL(src, location.href).pathname.startsWith('/cdn/');
    } catch {
      return false;
    }
  }

  function preloadImage(url, timeoutMs = 15000) {
    return new Promise((resolve) => {
      const probe = new Image();
      const timer = setTimeout(() => {
        probe.src = '';
        resolve(false);
      }, timeoutMs);
      probe.onload = () => {
        clearTimeout(timer);
        resolve(true);
      };
      probe.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
      probe.src = url;
    });
  }

  // Two request lanes keep the recolor service load modest on large grids.
  const queue = [];
  let active = 0;
  function enqueue(job) {
    queue.push(job);
    pump();
  }
  function pump() {
    while (active < 2 && queue.length) {
      const job = queue.shift();
      active++;
      job().finally(() => {
        active--;
        pump();
      });
    }
  }

  // Normalized original url → loaded render url. Lets the hover swap-back
  // (cards restore their stock src on mouseout) be re-recolored without a
  // network round-trip.
  const renders = new Map();

  async function recolorCard(img) {
    const src = img.currentSrc || img.src;
    if (!src || !isShopImage(src)) return;
    const original = stripImageSizeParams(publicImageUrl(src));
    try {
      const data = await recolorLensImage(original, slug);
      // Swap only once the render actually loaded — an unreachable CDN must
      // never blank a card; the original photo simply stays.
      if (!data?.url || !(await preloadImage(data.url))) return;
      renders.set(original, data.url);
      img.srcset = '';
      img.removeAttribute('sizes');
      img.src = data.url;
    } catch {
      // keep the original photo
    }
  }

  // Re-assert a known render when a card restores its stock photo (hover-out,
  // grid morphs). Hover's secondary photos aren't in the map and stay as is.
  function reassertRenders() {
    if (!slug || renders.size === 0) return;
    for (const img of document.querySelectorAll(`${GRID} img.product-media__image`)) {
      const src = img.currentSrc || img.src;
      if (!src || !isShopImage(src)) continue;
      const render = renders.get(stripImageSizeParams(publicImageUrl(src)));
      if (render && img.src !== render) {
        img.srcset = '';
        img.removeAttribute('sizes');
        img.src = render;
      }
    }
  }

  const seen = new WeakSet();
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        enqueue(() => recolorCard(entry.target));
      }
    },
    { rootMargin: '300px' }
  );

  // Lazy: only the first (featured) photo of each card, as it nears the viewport.
  function observeCards() {
    if (!slug) return;
    for (const card of document.querySelectorAll(`${GRID} product-card`)) {
      const img = card.querySelector('img.product-media__image');
      if (!img || seen.has(img)) continue;
      seen.add(img);
      io.observe(img);
    }
  }

  let debounceTimer = null;
  let reassertRaf = 0;
  function refresh() {
    rewriteLinks();
    observeCards();
  }

  refresh();

  // Pagination, filtering and sorting morph the grid (childList); the hover
  // swap-back only touches src/srcset, and picking a swatch rewrites the card's
  // href back to the plain product URL — all of them need a pass. Rewrites of
  // our own skip links that already carry the view, so this cannot loop.
  const main = document.querySelector('main');
  if (main) {
    new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refresh, 150);
      cancelAnimationFrame(reassertRaf);
      reassertRaf = requestAnimationFrame(reassertRenders);
    }).observe(main, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'href'],
    });
  }
})();
