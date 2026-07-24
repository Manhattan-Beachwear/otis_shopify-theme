/**
 * Need RX page controller.
 *
 * `<rx-my-orders>` hosts the order cards and the shared prescription drawer
 * (rx-prescription.js). Each `<rx-order-card>` shows its live lab status and,
 * when a prescription is still needed, opens the drawer. When the drawer reports
 * a submitted prescription (`rx:prescription-submit`), the card's ids are written
 * back to the order line item via the App Proxy.
 *
 * Browser-only: imports `@theme/component`, so it is never loaded under node.
 */

import { Component } from '@theme/component';

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

const { getOrder, getPrescriptionFile, updateLineItemProperties } = await rxImport('rx-api.js');

// Lab status → badge label + tone. `rx_needed` is the only state that still
// offers the "Add prescription" action; everything else reads as submitted.
const STATUS = {
  rx_needed: { label: 'Prescription needed', tone: 'pending' },
  rx_received: { label: 'Prescription received', tone: 'info' },
  sent: { label: 'Sent to lab', tone: 'info' },
  sent_to_lab: { label: 'Sent to lab', tone: 'info' },
  in_progress: { label: 'In progress', tone: 'info' },
  manufacturing: { label: 'In progress', tone: 'info' },
  shipped: { label: 'Shipped', tone: 'success' },
  delivered: { label: 'Delivered', tone: 'success' },
  completed: { label: 'Completed', tone: 'success' },
};

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])
  );
}

// Pull a named line-item property out of the backend order shape (array of
// {name, value} pairs, per the App Proxy contract).
function findProperty(order, name) {
  for (const item of order?.line_items ?? []) {
    for (const prop of item?.properties ?? []) {
      if (prop?.name === name && prop?.value) return prop.value;
    }
  }
  return null;
}

/**
 * Section wrapper: owns the single drawer and routes its submit result to the
 * card that opened it.
 */
class RxMyOrders extends Component {
  #drawer = null;
  #activeCard = null;

  connectedCallback() {
    super.connectedCallback();
    this.#drawer = this.querySelector('rx-prescription-drawer');
    this.addEventListener('rx:prescription-submit', this.#onSubmit);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('rx:prescription-submit', this.#onSubmit);
  }

  get config() {
    return {
      subdomain: this.dataset.subdomain || '',
      providerNumber: this.dataset.providerNumber || '',
    };
  }

  // Open the shared drawer for a specific card. Clears any prescription left in
  // the shared state so the drawer starts empty for each order.
  openFor(card) {
    this.#activeCard = card;
    if (window.rxState) {
      window.rxState.prescription = { method: null, values: null, uniqueId: null, rxUID: null, expired: false };
    }
    this.#drawer?.start();
  }

  #onSubmit = (event) => {
    const card = this.#activeCard;
    if (!card) return;
    const rx = event.detail;
    // "Add later" is a no-op here — the order already exists, nothing to attach.
    if (!rx || rx.method === 'later') return;
    card.attach(rx, this.config);
  };
}

/**
 * Per-order card: fetches live status on connect, renders the status badge and
 * the appropriate action, and attaches a submitted prescription to the order.
 */
class RxOrderCard extends Component {
  #labStatus = 'rx_needed';
  #uniqueId = null;
  #previewUrl = null;

  get #statusEl() {
    return this.querySelector('[data-rx-status]');
  }

  get #actionsEl() {
    return this.querySelector('[data-rx-actions]');
  }

  get orderId() {
    return this.dataset.orderId;
  }

  get lineItemId() {
    return this.dataset.lineItemId;
  }

  get #trackingNumber() {
    return this.dataset.trackingNumber || null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.#labStatus = this.dataset.labStatus || 'rx_needed';
    this.addEventListener('click', this.#onClick);
    this.#load();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('click', this.#onClick);
  }

  #onClick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest('[data-rx-add]')) return void this.#openDrawer();
    if (target.closest('[data-rx-view]') && this.#previewUrl) {
      return void window.open(this.#previewUrl, '_blank', 'noopener');
    }
    if (target.closest('[data-rx-copy]')) return void this.#copyTracking(target.closest('[data-rx-copy]'));
  };

  // Fetch the live order, letting the metafield lab status win, then render.
  async #load() {
    try {
      const data = await getOrder({ orderId: this.orderId });
      const order = data?.order || data || {};
      let status = data?.labStatus || order.labStatus || 'rx_needed';
      // Metafield status (from Liquid) is authoritative when present.
      if (this.dataset.labStatus) status = this.dataset.labStatus;
      this.#labStatus = status;

      this.#uniqueId = findProperty(order, 'uniqueId');
      if (this.#uniqueId) await this.#loadPreview();
    } catch (error) {
      // Order missing from the proxy = prescription not submitted yet.
      console.warn('rx: order status unavailable, treating as needed', this.orderId, error);
      this.#labStatus = this.dataset.labStatus || 'rx_needed';
    }

    this.#renderStatus();
    this.#renderActions();
  }

  async #loadPreview() {
    try {
      const file = await getPrescriptionFile(this.#uniqueId);
      this.#previewUrl = file?.fileUrl || file?.url || null;
    } catch (error) {
      console.warn('rx: prescription file unavailable', error);
    }
  }

  #openDrawer() {
    this.closest('rx-my-orders')?.openFor(this);
  }

  /**
   * Attach a submitted prescription to this order's line item. Updates the card
   * optimistically so the customer sees the result even if the proxy lags.
   * @param {{method: string, uniqueId: ?string, rxUID: ?string}} rx
   * @param {{subdomain: string}} config
   */
  async attach(rx, config) {
    this.#setStatusLoading('Saving…');
    if (this.#actionsEl) this.#actionsEl.innerHTML = '';

    const properties = { rx_method: rx.uniqueId ? 'file' : 'manual' };
    if (rx.rxUID) properties['Prescription RX UID'] = rx.rxUID;
    if (rx.uniqueId) properties.uniqueId = rx.uniqueId;

    try {
      await updateLineItemProperties({
        subdomain: config.subdomain,
        orderId: this.orderId,
        lineItemId: this.lineItemId,
        properties,
      });
    } catch (error) {
      console.error('rx: could not attach prescription', error);
    }

    this.#uniqueId = rx.uniqueId || this.#uniqueId;
    if (this.#labStatus === 'rx_needed') this.#labStatus = 'rx_received';
    if (this.#uniqueId && !this.#previewUrl) await this.#loadPreview();

    this.#renderStatus();
    this.#renderActions();
  }

  #setStatusLoading(text) {
    const el = this.#statusEl;
    if (!el) return;
    el.innerHTML = `
      <span class="rx-order-card__loading">
        <span class="rx-order-card__spinner" aria-hidden="true"></span>
        <span>${escapeHtml(text)}</span>
      </span>
    `;
  }

  #renderStatus() {
    const el = this.#statusEl;
    if (!el) return;

    const info = STATUS[this.#labStatus] || { label: this.#labStatus || 'Unknown', tone: 'pending' };
    let html = `<span class="rx-order-card__badge rx-order-card__badge--${info.tone}">${escapeHtml(info.label)}</span>`;

    if (this.#trackingNumber) {
      html += `
        <div class="rx-order-card__tracking">
          <span class="rx-order-card__tracking-label">Tracking</span>
          <button type="button" class="button button-unstyled rx-order-card__tracking-value" data-rx-copy title="Copy tracking number">
            ${escapeHtml(this.#trackingNumber)}
          </button>
        </div>
      `;
    }

    el.innerHTML = html;
  }

  #renderActions() {
    const el = this.#actionsEl;
    if (!el) return;

    if (this.#labStatus === 'rx_needed') {
      el.innerHTML = `
        <button type="button" class="button rx-order-card__add" data-rx-add>Add prescription</button>
      `;
      return;
    }

    let html = `
      <p class="rx-order-card__submitted">
        <span class="rx-order-card__check" aria-hidden="true">✓</span>
        Prescription submitted
      </p>
    `;
    if (this.#previewUrl) {
      html += `<button type="button" class="button button-secondary rx-order-card__view" data-rx-view>View prescription</button>`;
    }
    el.innerHTML = html;
  }

  async #copyTracking(button) {
    const value = this.#trackingNumber;
    if (!value || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      const original = button.getAttribute('title');
      button.setAttribute('title', 'Copied');
      button.classList.add('rx-order-card__tracking-value--copied');
      setTimeout(() => {
        button.classList.remove('rx-order-card__tracking-value--copied');
        if (original) button.setAttribute('title', original);
      }, 1500);
    } catch (error) {
      console.warn('rx: could not copy tracking number', error);
    }
  }
}

if (!customElements.get('rx-order-card')) {
  customElements.define('rx-order-card', RxOrderCard);
}

if (!customElements.get('rx-my-orders')) {
  customElements.define('rx-my-orders', RxMyOrders);
}

