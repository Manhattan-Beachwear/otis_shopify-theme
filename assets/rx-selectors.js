import { Component } from '@theme/component';
import { RxState, pickTier, resolveLensProduct, formatCents } from './rx-core.js';

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

// Categories that actually resolved to at least one lens product.
function validCategories() {
  return (getRxProductData()?.lensCategories ?? []).filter((category) => category.products?.length);
}

// Power tier for the current prescription (standard until one is entered).
function currentTier(state) {
  const threshold = getRxProductData()?.config?.tierSphThreshold ?? 2;
  return pickTier(state.prescription?.values, threshold);
}

function toLensSelection(product) {
  return {
    id: product.id,
    variantId: product.variantId,
    sku: product.sku,
    price: product.price,
    title: product.title,
    color: product.color,
  };
}

/**
 * Lens category picker (Clear / Sunglasses / Photochromic). Seeds the shared
 * state with the frame and drives `rxState.lensCategory`.
 */
class RxLensSelector extends Component {
  #state;
  #onChange = () => this.#reflect();

  connectedCallback() {
    super.connectedCallback();
    this.#state = getRxState();

    const data = getRxProductData();
    if (data?.frame) this.#state.set('frame', data.frame);

    const categories = validCategories();
    const keys = new Set(categories.map((category) => category.key));

    // Drop cards whose category never resolved to a product; show the
    // category's starting price (cheapest non-high-tier lens) on the rest.
    for (const card of this.querySelectorAll('[data-category-key]')) {
      const category = categories.find((entry) => entry.key === card.dataset.categoryKey);
      card.hidden = !category;
      const priceEl = card.querySelector('[data-rx-cat-price]');
      if (category && priceEl) {
        const prices = category.products
          .filter((p) => (p.tier ?? 'any') !== 'high')
          .map((p) => p.price || 0);
        if (prices.length) {
          priceEl.textContent = `From ${formatCents(Math.min(...prices))}`;
          priceEl.hidden = false;
        }
      }
    }

    // A single option needs no picker — auto-select it and hide the control.
    if (categories.length === 1) {
      this.hidden = true;
      this.selectCategory({ key: categories[0].key });
    } else if (!this.#state.lensCategory) {
      // Preselect the configured default (e.g. Clear) so the flow starts open.
      const preferred = this.dataset.defaultCategory;
      if (preferred && keys.has(preferred)) this.selectCategory({ key: preferred });
    }

    this.#state.addEventListener('rx:change', this.#onChange);
    this.#reflect();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#state?.removeEventListener('rx:change', this.#onChange);
  }

  /** @param {{key: string}} data */
  selectCategory(data) {
    const category = validCategories().find((entry) => entry.key === data?.key);
    if (!category) return;

    // Changing category invalidates the downstream vision + lens choices.
    this.#state.set('lensCategory', category.key);
    this.#state.set('visionType', null);
    this.#state.set('lensProduct', null);
  }

  #reflect() {
    const active = this.#state.lensCategory;
    for (const card of this.querySelectorAll('[data-category-key]')) {
      const selected = card.dataset.categoryKey === active;
      card.classList.toggle('rx-lens-selector__card--selected', selected);
      card.setAttribute('aria-checked', selected ? 'true' : 'false');
    }
  }
}

/**
 * Vision type picker (Single Vision / Progressive / Non-RX). Hidden until a
 * category is chosen; sets `rxState.visionType` and the matching lens product.
 */
class RxVisionSelector extends Component {
  #state;
  #onChange = (event) => {
    this.#reflect();
    if (event.detail?.key === 'prescription') this.#retier();
  };

  connectedCallback() {
    super.connectedCallback();
    this.#state = getRxState();
    this.#state.addEventListener('rx:change', this.#onChange);
    this.#reflect();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#state?.removeEventListener('rx:change', this.#onChange);
  }

  /** @param {{type: string}} data */
  selectVision(data) {
    const type = data?.type;
    const category = this.#activeCategory();
    if (!category || !this.#availableTypes(category).includes(type)) return;

    // Non-RX still ships a lens; resolveLensProduct maps it to single vision.
    const product =
      resolveLensProduct(category.products, {
        visionType: type,
        color: null,
        tier: currentTier(this.#state),
      }) ?? category.products[0];

    this.#state.set('visionType', type);
    if (product) this.#state.set('lensProduct', toLensSelection(product));
  }

  // The entered prescription can move the lens to another power tier; swap the
  // product while keeping the chosen color.
  #retier() {
    const state = this.#state;
    const category = this.#activeCategory();
    if (!category || !state.visionType || !state.lensProduct) return;

    const product = resolveLensProduct(category.products, {
      visionType: state.visionType,
      color: state.lensProduct.color ?? null,
      tier: currentTier(state),
    });
    if (product && product.variantId !== state.lensProduct.variantId) {
      state.set('lensProduct', toLensSelection(product));
    }
  }

  #activeCategory() {
    return validCategories().find((category) => category.key === this.#state.lensCategory) ?? null;
  }

  // Vision types offered for a category: those with products, plus Non-RX when enabled.
  #availableTypes(category) {
    const types = new Set(category.products.map((entry) => entry.visionType));
    if (this.dataset.showNonRx !== 'false') types.add('non_rx');
    return [...types];
  }

  #reflect() {
    const category = this.#activeCategory();
    this.hidden = !category;
    if (!category) return;

    const available = this.#availableTypes(category);

    // A single available type needs no picker: choose it and stay hidden.
    // Deferred: #reflect runs inside rx:change dispatch, and selecting
    // synchronously here gets clobbered by the caller's remaining resets
    // (selectCategory nulls visionType/lensProduct after setting the category).
    if (available.length === 1) {
      this.hidden = true;
      queueMicrotask(() => {
        const current = this.#activeCategory();
        if (!current) return;
        const types = this.#availableTypes(current);
        if (types.length === 1 && this.#state.visionType !== types[0]) {
          this.selectVision({ type: types[0] });
        }
      });
      return;
    }

    const active = this.#state.visionType;
    for (const option of this.querySelectorAll('[data-vision-type]')) {
      const type = option.dataset.visionType;
      option.hidden = !available.includes(type);
      const selected = type === active;
      option.classList.toggle('rx-vision-selector__option--selected', selected);
      option.setAttribute('aria-checked', selected ? 'true' : 'false');
    }
  }
}

if (!customElements.get('rx-lens-selector')) {
  customElements.define('rx-lens-selector', RxLensSelector);
}

if (!customElements.get('rx-vision-selector')) {
  customElements.define('rx-vision-selector', RxVisionSelector);
}
