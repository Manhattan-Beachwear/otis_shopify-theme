import { Component } from '@theme/component';
import { RxState, formatCents } from './rx-core.js';

// Shared singleton — the first RX component to initialize creates the state.
function getRxState() {
  window.rxState ??= new RxState();
  return window.rxState;
}

// Product data JSON emitted once by the rx-lens-selector block. Cached on first
// successful parse; re-tried while absent so component init order doesn't matter.
let productDataCache = null;
function getRxProductData() {
  if (productDataCache) return productDataCache;
  const el = document.querySelector('[data-rx-product-data]');
  if (!el) return null;
  try {
    productDataCache = JSON.parse(el.textContent);
  } catch (error) {
    console.error('rx: invalid product data', error);
    return null;
  }
  return productDataCache;
}

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])
  );
}

// Recognizable lens tints, in muted "lens-like" shades rather than raw CSS colors.
const TINTS = {
  grey: '#8d8d8f',
  gray: '#8d8d8f',
  brown: '#5f4432',
  green: '#4e5c50',
  blue: '#3d6da6',
  gold: '#d0b24a',
  yellow: '#d8c04f',
  silver: '#b9bcc0',
  red: '#a2453e',
  rose: '#c98a97',
  amber: '#c58f3d',
};

// Fallback copy per lens color/coating when the variant metafield
// custom.short_lens_color_description is empty. Keys are lowercase colors.
const FALLBACK_DESCRIPTIONS = {
  'grey polar': 'Neutral grey polarized lens that cuts glare and keeps colors true',
  'green polar': 'Classic green polarized lens with crisp contrast in bright light',
  'brown polar': 'Warm brown polarized lens that boosts contrast and depth',
  'grey polar mirror blue': 'Grey polarized lens with a blue mirror finish',
  'grey polar mirror green': 'Grey polarized lens with a green mirror finish',
  'grey trans': 'Light-adaptive grey lens that darkens in the sun',
  'brown trans': 'Light-adaptive brown lens that darkens in the sun',
  'clear': 'Standard clear lens',
  'clear + ar': 'Clear lens with premium anti-reflective coating',
  'clear blue blocking + ar': 'Clear lens with blue-light filtering and anti-reflective coating',
};

/**
 * CSS background for a lens color name: known tint words become muted solids,
 * two tints (mirror finishes) a diagonal gradient, "gradient" a top-down fade,
 * clear coatings a light neutral.
 */
function swatchFill(name) {
  const lower = String(name || '').toLowerCase();
  const tints = lower.split(/[^a-z]+/).map((w) => TINTS[w]).filter(Boolean);

  if (lower.includes('blocking')) return '#ece5c8';
  if (tints.length === 0) return lower.includes('clear') ? '#efefef' : '#cccccc';
  if (lower.includes('gradient')) return `linear-gradient(180deg, ${tints[0]} 20%, #d9cfc2 95%)`;
  if (tints.length > 1) return `linear-gradient(135deg, ${tints[0]} 45%, ${tints[1]} 55%)`;
  return tints[0];
}

/**
 * Lens color options. Hidden until a category + vision type are chosen; shows
 * color swatches only for the configured color categories (default sunglasses /
 * photochromic) when the selected lens product offers more than one color.
 * Picking a color writes the matching variant to `rxState.lensProduct`.
 */
class RxLensOptions extends Component {
  #state;
  #colors = [];
  #defs = null;
  #onChange = () => this.#render();

  // Merchant-defined color overrides from nested rx-color blocks, keyed by
  // lowercase color name.
  #colorDefs() {
    if (this.#defs) return this.#defs;
    this.#defs = {};
    for (const node of this.querySelectorAll('[data-rx-color-def]')) {
      try {
        const def = JSON.parse(node.textContent);
        if (def?.name) this.#defs[def.name.toLowerCase()] = def;
      } catch {
        // ignore malformed block data
      }
    }
    return this.#defs;
  }

  #fillFor(color) {
    const def = this.#colorDefs()[String(color || '').toLowerCase()];
    if (def?.color) {
      return def.color2 ? `linear-gradient(135deg, ${def.color} 45%, ${def.color2} 55%)` : def.color;
    }
    return swatchFill(color);
  }

  #descriptionFor(variant) {
    const def = this.#colorDefs()[String(variant.color || '').toLowerCase()];
    return (
      def?.description ||
      variant.colorDescription ||
      FALLBACK_DESCRIPTIONS[String(variant.color || '').toLowerCase()] ||
      ''
    );
  }

  connectedCallback() {
    super.connectedCallback();
    this.#state = getRxState();
    this.#state.addEventListener('rx:change', this.#onChange);
    this.#render();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#state?.removeEventListener('rx:change', this.#onChange);
  }

  // Category keys that show a color picker; empty means "any category".
  get #colorCategories() {
    return (this.dataset.colorCategories || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  #activeCategory() {
    const data = getRxProductData();
    return (data?.lensCategories ?? []).find((category) => category.key === this.#state.lensCategory) ?? null;
  }

  // Color variants of the currently selected lens product.
  #colorVariants() {
    const category = this.#activeCategory();
    const lens = this.#state.lensProduct;
    if (!category || !lens) return [];
    // Non-RX ships the single-vision lens; match its vision type for lookup.
    const lookup = this.#state.visionType === 'non_rx' ? 'single_vision' : this.#state.visionType;
    return category.products.filter(
      (product) => product.id === lens.id && product.visionType === lookup && product.color != null
    );
  }

  /** @param {{index: number}} data */
  selectColor(data) {
    const variant = this.#colors[data?.index];
    if (!variant) return;
    this.#state.set('lensProduct', {
      id: variant.id,
      variantId: variant.variantId,
      sku: variant.sku,
      price: variant.price,
      title: variant.title,
      color: variant.color,
    });
  }

  #swatchHtml(variant, index, selected) {
    const label = variant.color || '';
    const itemClass = `rx-lens-options__swatch-item${selected ? ' rx-lens-options__swatch-item--selected' : ''}`;
    return `
      <button
        type="button"
        class="${itemClass}"
        role="radio"
        aria-checked="${selected ? 'true' : 'false'}"
        aria-label="${escapeHtml(label)}"
        on:click="/selectColor?index=${index}"
      >
        <span class="rx-lens-options__dot" style="background: ${this.#fillFor(variant.color)};"></span>
      </button>
    `;
  }

  // Selected option details under the swatches: NAME +$delta and a description.
  #infoHtml(variant, basePrice) {
    if (!variant) return '';
    const delta = (variant.price || 0) - basePrice;
    const description = this.#descriptionFor(variant);
    return `
      <p class="rx-lens-options__info-name">
        ${escapeHtml(variant.color || '')}
        ${delta > 0 ? `<span class="rx-lens-options__info-delta">+${formatCents(delta)}</span>` : ''}
      </p>
      ${description ? `<p class="rx-lens-options__info-desc">${escapeHtml(description)}</p>` : ''}
    `;
  }

  #render() {
    const container = this.refs.swatches ?? this.querySelector('.rx-lens-options__swatches');
    const info = this.refs.info ?? this.querySelector('.rx-lens-options__info');
    if (!container) return;

    const categories = this.#colorCategories;
    const eligible = categories.length === 0 || categories.includes(this.#state.lensCategory);
    const colors = eligible ? this.#colorVariants() : [];

    // Nothing to choose between → stay hidden.
    if (colors.length < 2) {
      this.#colors = [];
      this.hidden = true;
      container.replaceChildren();
      info?.replaceChildren();
      return;
    }

    this.#colors = colors;
    this.hidden = false;

    const selectedVariantId = this.#state.lensProduct?.variantId;
    const selected = colors.find((variant) => variant.variantId === selectedVariantId) ?? null;
    const basePrice = Math.min(...colors.map((variant) => variant.price || 0));

    container.innerHTML = colors
      .map((variant, index) => this.#swatchHtml(variant, index, variant.variantId === selectedVariantId))
      .join('');
    if (info) info.innerHTML = this.#infoHtml(selected, basePrice);
  }
}

if (!customElements.get('rx-lens-options')) {
  customElements.define('rx-lens-options', RxLensOptions);
}

