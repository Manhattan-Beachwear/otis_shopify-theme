import { Component } from '@theme/component';
import { DialogComponent } from '@theme/dialog';
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

const {
  RxState,
  validatePrescription,
  mapOcrToValues,
  isPrescriptionExpired,
  normalizeDateToIso,
  pickTier,
  resolveLensProduct,
  formatCents,
} = await rxImport('rx-core.js');
const { analyzePrescription, savePrescription } = await rxImport('rx-api.js');

// Shared singleton — the first RX component to initialize creates the state.
function getRxState() {
  window.rxState ??= new RxState();
  return window.rxState;
}

const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'pdf'];
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])
  );
}

function isFilled(value) {
  return value != null && value !== '' && value !== 'Select';
}

/**
 * Fired when the drawer collects a prescription (or the "add later" choice).
 * `detail` mirrors `RxState.prescription`. Bubbles so a host section
 * (e.g. my-orders) can react without touching the shared PDP state.
 */
export class RxPrescriptionSubmitEvent extends CustomEvent {
  static eventName = 'rx:prescription-submit';
  constructor(detail) {
    super(RxPrescriptionSubmitEvent.eventName, { bubbles: true, detail });
  }
}

/**
 * Prescription drawer: an over-the-page `<dialog>` with three paths — upload a
 * file (OCR → pre-filled form), enter values manually, or defer ("add later").
 * On submit it validates, best-effort saves to the App Proxy, then writes the
 * result to the shared RX state and emits `rx:prescription-submit`.
 */
class RxPrescriptionDrawer extends DialogComponent {
  #state;
  #limits = {};
  #config = {};

  #step = 'INITIAL'; // 'INITIAL' | 'MANUAL'
  #analyzing = false;
  #submitting = false;
  #method = null; // 'upload' | 'manual'
  #values = {};
  #uniqueId = null;
  #rxUID = null;
  #fileName = null;
  #fileUrl = null;
  #fileIsPdf = false;
  #fileError = false;
  #hiIndexConsent = false;
  #pendingUpgrade = null;
  #apiError = null;
  #dualPd = false;
  #showPrism = false;
  #errors = {};

  connectedCallback() {
    super.connectedCallback();
    this.#state = getRxState();
    this.#limits = this.#parseJson(this.dataset.limits) || {};
    this.#config = {
      subdomain: this.dataset.subdomain || '',
      providerNumber: this.dataset.providerNumber || '',
      checkExpiration: this.dataset.checkExpiration !== 'false',
      healthFundNumbers: this.dataset.healthFundNumbers || '',
      tierSphThreshold: Number(this.dataset.tierSphThreshold) || 2,
    };

    this.addEventListener('click', this.#onClick);
    this.addEventListener('change', this.#onChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('click', this.#onClick);
    this.removeEventListener('change', this.#onChange);
  }

  #parseJson(str) {
    try {
      return str ? JSON.parse(str) : null;
    } catch {
      return null;
    }
  }

  get #body() {
    return this.refs.body ?? this.querySelector('[data-rx-body]');
  }

  // --- Public entry point (called from a trigger via on:click) ---------------

  start() {
    this.#reset();
    this.#render();
    this.showDialog();
  }

  #reset() {
    this.#step = 'INITIAL';
    this.#analyzing = false;
    this.#submitting = false;
    this.#fileError = false;
    this.#apiError = null;
    this.#errors = {};
    this.#hiIndexConsent = false;
    this.#pendingUpgrade = null;
    // Preserve a prescription already captured this session so the user can edit it.
    const existing = this.#state?.prescription;
    if (existing && existing.method && existing.method !== 'later') {
      this.#method = existing.method;
      this.#values = { ...(existing.values || {}) };
      this.#uniqueId = existing.uniqueId ?? null;
      this.#rxUID = existing.rxUID ?? null;
      this.#dualPd = isFilled(this.#values.pd_left) || isFilled(this.#values.pd_right);
      this.#showPrism = Object.keys(this.#values).some((key) => key.startsWith('prism_'));
    } else {
      this.#method = null;
      this.#values = {};
      this.#uniqueId = null;
      this.#rxUID = null;
      this.#fileName = null;
      if (this.#fileUrl) URL.revokeObjectURL(this.#fileUrl);
      this.#fileUrl = null;
      this.#fileIsPdf = false;
      this.#dualPd = false;
      this.#showPrism = false;
    }
  }

  goBack = () => {
    this.#step = this.#step === 'HI_INDEX' ? 'MANUAL' : 'INITIAL';
    this.#errors = {};
    this.#apiError = null;
    this.#render();
  };

  // --- High Index upgrade ----------------------------------------------------

  #productData() {
    const el = document.querySelector('[data-rx-product-data]');
    try {
      return el ? JSON.parse(el.textContent) : null;
    } catch {
      return null;
    }
  }

  /**
   * When the entered prescription lands in the high power tier and the matching
   * High Index product costs more than the current lens, returns the upgrade
   * offer; otherwise null (already high-tier, no counterpart, or no upcharge).
   */
  #hiIndexUpgrade() {
    const state = this.#state;
    if (!state?.lensProduct || !state.lensCategory) return null;
    if (pickTier(this.#values, this.#config.tierSphThreshold) !== 'high') return null;

    const category = this.#productData()?.lensCategories?.find((c) => c.key === state.lensCategory);
    if (!category) return null;

    const high = resolveLensProduct(category.products, {
      visionType: state.visionType,
      color: state.lensProduct.color ?? null,
      tier: 'high',
    });
    if (!high || high.variantId === state.lensProduct.variantId) return null;

    const delta = (high.price || 0) - (state.lensProduct.price || 0);
    if (delta <= 0) return null;

    return { delta, newLensPrice: high.price, newTotal: (state.frame?.price || 0) + (high.price || 0) };
  }

  // --- Event delegation ------------------------------------------------------

  #onClick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const action = target.closest('[data-rx-close]')
      ? this.closeDialog
      : target.closest('[data-rx-back]')
        ? this.goBack
        : target.closest('[data-rx-upload]')
          ? () => this.querySelector('[data-rx-file]')?.click()
          : target.closest('[data-rx-manual]')
            ? () => this.#openManual()
            : target.closest('[data-rx-later]')
              ? () => this.#addLater()
              : target.closest('[data-rx-hi-agree]')
                ? () => {
                    this.#hiIndexConsent = true;
                    this.#step = 'MANUAL';
                    this.#submit();
                  }
                : target.closest('[data-rx-submit]')
                  ? () => this.#submit()
                  : null;
    if (!action) return;

    // Deferred: DialogComponent's outside-click check runs on this same event,
    // and re-rendering now would detach the target and read as an outside click.
    // Must be a macrotask — for real (browser-dispatched) clicks a microtask
    // checkpoint runs BETWEEN listeners, which would re-render too early.
    setTimeout(action, 0);
  };

  #onChange = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.matches('[data-rx-file]')) {
      const file = /** @type {HTMLInputElement} */ (target).files?.[0];
      if (file) this.#handleFile(file);
      return;
    }
    if (target.matches('[data-rx-dual-pd]')) {
      this.#collect();
      this.#dualPd = /** @type {HTMLInputElement} */ (target).checked;
      this.#render();
      return;
    }
    if (target.matches('[data-rx-prism-toggle]')) {
      this.#collect();
      this.#showPrism = /** @type {HTMLInputElement} */ (target).checked;
      this.#render();
      return;
    }
    if (target.matches('[data-rx-field]')) {
      const field = target.dataset.rxField;
      this.#values[field] = /** @type {HTMLInputElement|HTMLSelectElement} */ (target).value;
      // The date drives the expiry warning — refresh it live.
      if (field === 'date') this.#renderExpiryWarning();
    }
  };

  // Read all current field values back into #values (before a re-render).
  #collect() {
    for (const el of this.querySelectorAll('[data-rx-field]')) {
      this.#values[el.dataset.rxField] = /** @type {HTMLInputElement} */ (el).value;
    }
  }

  // --- Flows -----------------------------------------------------------------

  #openManual() {
    this.#step = 'MANUAL';
    this.#errors = {};
    this.#render();
  }

  #addLater() {
    const prescription = { method: 'later', values: null, uniqueId: null, rxUID: null, expired: false };
    this.#state.set('prescription', prescription);
    this.dispatchEvent(new RxPrescriptionSubmitEvent(prescription));
    this.closeDialog();
  }

  #validFile(file) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    return ALLOWED_TYPES.includes(file.type) || ALLOWED_EXTENSIONS.includes(ext);
  }

  async #handleFile(file) {
    this.#fileError = false;
    if (!this.#validFile(file)) {
      this.#fileError = true;
      this.#render();
      return;
    }

    this.#method = 'upload';
    this.#fileName = file.name;
    if (this.#fileUrl) URL.revokeObjectURL(this.#fileUrl);
    this.#fileUrl = URL.createObjectURL(file);
    this.#fileIsPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    this.#analyzing = true;
    this.#apiError = null;
    this.#render();

    try {
      const result = await analyzePrescription(file);
      this.#uniqueId = result.uniqueId || null;
      this.#rxUID = result.rxUID || null;

      const mapped = mapOcrToValues(result.prescriptionData);
      const details = result.analysis?.consensus?.prescriptionDetails;
      const detailsDate = normalizeDateToIso(details?.prescriptionDate);
      if (detailsDate) mapped.date = detailsDate;

      this.#values = { ...this.#values, ...mapped };
      if (isFilled(mapped.pd_left) || isFilled(mapped.pd_right)) this.#dualPd = true;
    } catch (error) {
      // OCR failed — fall back to manual entry with a friendly notice.
      console.error('rx: prescription analysis failed', error);
      this.#method = 'manual';
      this.#apiError = 'We could not read that file automatically. Please enter your prescription below.';
    } finally {
      this.#analyzing = false;
      this.#step = 'MANUAL';
      this.#render();
    }
  }

  async #submit() {
    this.#collect();
    const result = validatePrescription(this.#values, this.#limits, {
      checkExpiration: this.#config.checkExpiration,
    });
    this.#errors = result.errors;

    if (!result.valid) {
      this.#render();
      this.#body?.querySelector('.rx-prescription__field--error')?.scrollIntoView({ block: 'center' });
      return;
    }

    // A prescription beyond the standard power range needs the High Index
    // lens — an upcharge the customer has to agree to before we proceed.
    const upgrade = this.#hiIndexUpgrade();
    if (upgrade && !this.#hiIndexConsent) {
      this.#pendingUpgrade = upgrade;
      this.#step = 'HI_INDEX';
      this.#render();
      return;
    }

    // Expiry only warns — the submit proceeds and the flag is carried on.
    this.#submitting = true;
    this.#render();

    let rxUID = this.#rxUID;
    try {
      const saved = await savePrescription(this.#buildSavePayload());
      if (saved?.rxUID) rxUID = saved.rxUID;
    } catch (error) {
      // A save failure must not block checkout — the RX can be attached later.
      console.error('rx: save prescription failed', error);
    }
    this.#rxUID = rxUID;

    const prescription = {
      method: this.#method || 'manual',
      values: { ...this.#values },
      uniqueId: this.#uniqueId,
      rxUID,
      expired: result.expired,
    };
    this.#state.set('prescription', prescription);
    this.dispatchEvent(new RxPrescriptionSubmitEvent(prescription));

    this.#submitting = false;
    this.closeDialog();
  }

  // Shape the save-prescription payload per the backend contract.
  #buildSavePayload() {
    const v = this.#values;
    const num = (value, fallback) => (isFilled(value) ? String(value) : fallback);

    const prescriptionData = {
      sphRight: num(v.sph_od, '0.00'),
      sphLeft: num(v.sph_os, '0.00'),
      cylRight: num(v.cyl_od, '0.00'),
      cylLeft: num(v.cyl_os, '0.00'),
      axisRight: num(v.axis_od, '000'),
      axisLeft: num(v.axis_os, '000'),
      addRight: num(v.add_od, '0.00'),
      addLeft: num(v.add_os, '0.00'),
      isMonocularPd: this.#dualPd,
    };

    if (this.#dualPd) {
      prescriptionData.pdRight = `${num(v.pd_right, '0')}mm`;
      prescriptionData.pdLeft = `${num(v.pd_left, '0')}mm`;
    } else {
      prescriptionData.pdValue = `${num(v.pd, '0')}mm`;
    }
    if (isFilled(v.date)) prescriptionData.prescriptionDate = v.date;

    if (this.#showPrism) {
      const base = { U: 'Up', D: 'Down', I: 'In', O: 'Out' };
      const eye = (side, hDefault, vDefault) => ({
        horizontal: { value: num(v[`prism_h_${side}`], '0.00'), base: base[v[`prism_hdir_${side}`]] || hDefault },
        vertical: { value: num(v[`prism_v_${side}`], '0.00'), base: base[v[`prism_vdir_${side}`]] || vDefault },
      });
      const hasPrism = ['prism_h_od', 'prism_v_od', 'prism_h_os', 'prism_v_os'].some((key) => isFilled(v[key]));
      if (hasPrism) {
        prescriptionData.prismFormat = 'directional';
        prescriptionData.prismRight = eye('od', 'Out', 'Up');
        prescriptionData.prismLeft = eye('os', 'Out', 'Up');
      }
    }

    return {
      order_id: `cart-temp-${Date.now()}`,
      line_item_id: `prescription-${Date.now()}`,
      subdomain: this.#config.subdomain,
      data: { prescriptionData },
    };
  }

  // --- Rendering -------------------------------------------------------------

  #render() {
    const body = this.#body;
    if (!body) return;

    const back = this.refs.back;
    if (back instanceof HTMLElement) back.hidden = this.#step === 'INITIAL' || this.#analyzing;

    // Confirm view with a file preview gets the wide two-column dialog.
    const dialog = this.refs.dialog;
    if (dialog instanceof HTMLElement) {
      dialog.classList.toggle(
        'rx-prescription-drawer__dialog--wide',
        this.#step === 'MANUAL' && !this.#analyzing && Boolean(this.#fileUrl)
      );
    }

    if (this.#analyzing) {
      body.innerHTML = this.#loaderHtml();
      return;
    }
    body.innerHTML =
      this.#step === 'HI_INDEX'
        ? this.#hiIndexHtml()
        : this.#step === 'MANUAL'
          ? this.#manualHtml()
          : this.#initialHtml();
  }

  #hiIndexHtml() {
    const up = this.#pendingUpgrade;
    if (!up) return this.#manualHtml();
    return `
      <div class="rx-prescription__step rx-prescription__step--hi-index">
        <h2 class="rx-prescription__title">High Index lenses required</h2>
        <p class="rx-prescription__text">
          Your prescription is outside the standard power range, so these frames
          need thinner, lighter High Index lenses.
        </p>
        <div class="rx-prescription__hi-index-summary">
          <div class="rx-prescription__hi-index-row">
            <span>High Index upgrade</span>
            <span>+${formatCents(up.delta)}</span>
          </div>
          <div class="rx-prescription__hi-index-row rx-prescription__hi-index-row--total">
            <span>New total</span>
            <span>${formatCents(up.newTotal)}</span>
          </div>
        </div>
        <button type="button" class="button rx-prescription__submit" data-rx-hi-agree>
          Agree and continue (+${formatCents(up.delta)})
        </button>
        <button type="button" class="button button-unstyled rx-prescription__later-btn" data-rx-back>
          Back to prescription
        </button>
      </div>
    `;
  }

  #loaderHtml() {
    return `
      <div class="rx-prescription__loader" role="status" aria-live="polite">
        <span class="rx-prescription__spinner" aria-hidden="true"></span>
        <p class="rx-prescription__loader-text">Reading your prescription…</p>
      </div>
    `;
  }

  #initialHtml() {
    const total = this.#state.totalPrice;
    return `
      <div class="rx-prescription__step rx-prescription__step--initial">
        <h2 class="rx-prescription__title">Do you have a prescription?</h2>
        <p class="rx-prescription__subtitle">Upload it and we'll read the values for you, or enter them by hand.</p>

        <div class="rx-prescription__actions">
          <button type="button" class="button rx-prescription__action" data-rx-upload>Upload prescription</button>
          <span class="rx-prescription__or">or</span>
          <button type="button" class="button button-secondary rx-prescription__action" data-rx-manual>Enter it manually</button>
        </div>

        ${total ? `<div class="rx-prescription__subtotal"><span>Subtotal</span><span>${formatCents(total)}</span></div>` : ''}

        <div class="rx-prescription__later">
          <button type="button" class="button button-unstyled rx-prescription__later-btn" data-rx-later>Add prescription later</button>
          <p class="rx-prescription__subtitle">You can attach it from your account after checkout.</p>
        </div>
      </div>
    `;
  }

  #previewHtml() {
    if (!this.#fileUrl) return '';
    const media = this.#fileIsPdf
      ? `<embed class="rx-prescription__preview-media" src="${this.#fileUrl}" type="application/pdf">`
      : `<img class="rx-prescription__preview-media" src="${this.#fileUrl}" alt="Uploaded prescription">`;
    return `
      <aside class="rx-prescription__preview">
        ${media}
        <p class="rx-prescription__preview-name">${escapeHtml(this.#fileName || '')}</p>
      </aside>
    `;
  }

  #manualHtml() {
    const filled = Boolean(this.#fileName);
    const preview = this.#previewHtml();
    return `
      <div class="rx-prescription__step${preview ? ' rx-prescription__step--split' : ''}">
      <div class="rx-prescription__form-col">
        <h2 class="rx-prescription__title">${filled ? 'Confirm your prescription' : 'Enter your prescription'}</h2>
        ${filled && !preview ? `<p class="rx-prescription__file">Uploaded: ${escapeHtml(this.#fileName)}</p>` : ''}
        ${this.#apiError ? `<p class="rx-prescription__notice" role="alert">${escapeHtml(this.#apiError)}</p>` : ''}

        <div class="rx-prescription__table">
          <div class="rx-prescription__row rx-prescription__row--head" aria-hidden="true">
            <span></span><span>OD (Right)</span><span>OS (Left)</span>
          </div>
          ${this.#rowHtml('SPH', 'sph', 'sph', true)}
          ${this.#rowHtml('CYL', 'cyl', 'cyl', true)}
          ${this.#rowHtml('Axis', 'axis', 'axis', false, { pad: 3 })}
          ${this.#rowHtml('Add', 'add', 'add', true)}
        </div>

        ${this.#pdHtml()}
        ${this.#prismHtml()}

        <div class="rx-prescription__date">
          <label class="rx-prescription__label" for="rx-date-${this.id}">Prescription date</label>
          <input type="date" id="rx-date-${this.id}" class="rx-prescription__input" data-rx-field="date" value="${escapeHtml(this.#values.date || '')}">
        </div>

        <div data-rx-expiry>${this.#expiryWarningHtml()}</div>
      </div>
      ${preview}
      </div>

      <div class="rx-prescription__footer">
        <div class="rx-prescription__footer-summary">
          <span>Total</span>
          <span class="rx-prescription__footer-price">${formatCents(this.#state.totalPrice)}</span>
        </div>
        <button type="button" class="button rx-prescription__submit" data-rx-submit ${this.#submitting ? 'disabled aria-busy="true"' : ''}>
          ${this.#submitting ? 'Saving…' : 'Save prescription'}
        </button>
      </div>
    `;
  }

  // One OD/OS row of paired selects with per-cell error text.
  #rowHtml(label, field, limitKey, signed, opts = {}) {
    return `
      <div class="rx-prescription__row">
        <span class="rx-prescription__row-label">${label}</span>
        ${this.#cellHtml(`${field}_od`, limitKey, signed, opts)}
        ${this.#cellHtml(`${field}_os`, limitKey, signed, opts)}
      </div>
    `;
  }

  #cellHtml(field, limitKey, signed, opts) {
    const error = this.#errors[field];
    return `
      <span class="rx-prescription__field${error ? ' rx-prescription__field--error' : ''}">
        ${this.#selectHtml(field, limitKey, signed, opts)}
        ${error ? `<span class="rx-prescription__error">${escapeHtml(error)}</span>` : ''}
      </span>
    `;
  }

  #pdHtml() {
    const error = this.#errors.pd;
    return `
      <div class="rx-prescription__pd">
        <div class="rx-prescription__pd-head">
          <span class="rx-prescription__label">Pupillary distance (PD)</span>
          <label class="rx-prescription__toggle">
            <input type="checkbox" data-rx-dual-pd ${this.#dualPd ? 'checked' : ''}>
            <span>Two values</span>
          </label>
        </div>
        <div class="rx-prescription__pd-inputs${error ? ' rx-prescription__field--error' : ''}">
          ${
            this.#dualPd
              ? `${this.#selectHtml('pd_right', 'pd', false, { half: true, prefix: 'R' })}
                 ${this.#selectHtml('pd_left', 'pd', false, { half: true, prefix: 'L' })}`
              : this.#selectHtml('pd', 'pd', false, {})
          }
        </div>
        ${error ? `<span class="rx-prescription__error">${escapeHtml(error)}</span>` : ''}
      </div>
    `;
  }

  #prismHtml() {
    if (!this.#showPrism) {
      return `
        <label class="rx-prescription__toggle rx-prescription__toggle--block">
          <input type="checkbox" data-rx-prism-toggle>
          <span>I have prism values</span>
        </label>
      `;
    }
    const eye = (side, label) => `
      <fieldset class="rx-prescription__prism-eye">
        <legend>${label}</legend>
        <div class="rx-prescription__prism-row">
          <span>Vertical</span>${this.#selectHtml(`prism_v_${side}`, 'prism', false, {})}${this.#prismDirHtml(`prism_vdir_${side}`, 'vertical')}
        </div>
        <div class="rx-prescription__prism-row">
          <span>Horizontal</span>${this.#selectHtml(`prism_h_${side}`, 'prism', false, {})}${this.#prismDirHtml(`prism_hdir_${side}`, 'horizontal')}
        </div>
      </fieldset>
    `;
    return `
      <label class="rx-prescription__toggle rx-prescription__toggle--block">
        <input type="checkbox" data-rx-prism-toggle checked>
        <span>I have prism values</span>
      </label>
      <div class="rx-prescription__prism">${eye('od', 'Right (OD)')}${eye('os', 'Left (OS)')}</div>
    `;
  }

  #prismDirHtml(field, axis) {
    const options = axis === 'vertical' ? [['U', 'Up'], ['D', 'Down']] : [['I', 'In'], ['O', 'Out']];
    const current = this.#values[field] || '';
    return `
      <select class="rx-prescription__select" data-rx-field="${field}">
        <option value="">Base</option>
        ${options.map(([value, text]) => `<option value="${value}"${value === current ? ' selected' : ''}>${text}</option>`).join('')}
      </select>
    `;
  }

  // Build a value <select> from the configured limit range.
  #selectHtml(field, limitKey, signed, opts = {}) {
    const current = this.#values[field];
    const options = this.#options(limitKey, signed, opts);
    const label = opts.prefix ? `<span class="rx-prescription__mini">${opts.prefix}</span>` : '';
    return `
      ${label}<select class="rx-prescription__select" data-rx-field="${field}" aria-label="${escapeHtml(field)}">
        <option value="">Select</option>
        ${options
          .map((option) => {
            const selected = isFilled(current) && parseFloat(option) === parseFloat(current) ? ' selected' : '';
            return `<option value="${option}"${selected}>${option}</option>`;
          })
          .join('')}
      </select>
    `;
  }

  #options(limitKey, signed, opts) {
    const limit = this.#limits[limitKey] || {};
    let min = Number(limit.min ?? 0);
    let max = Number(limit.max ?? 0);
    const step = Number(limit.step) > 0 ? Number(limit.step) : 1;
    if (opts.half) {
      // Monocular PD is roughly half the binocular range.
      min = Math.floor(min / 2);
      max = Math.ceil(max / 2);
    }
    const count = Math.max(0, Math.round((max - min) / step));
    const out = [];
    for (let i = 0; i <= count; i++) {
      const n = min + i * step;
      out.push(this.#formatOption(n, signed, opts.pad));
    }
    return out;
  }

  #formatOption(n, signed, pad) {
    if (pad) return String(Math.round(n)).padStart(pad, '0');
    if (n === 0) return '0.00';
    const fixed = Math.abs(n).toFixed(2);
    if (n < 0) return `-${fixed}`;
    return signed ? `+${fixed}` : fixed;
  }

  #expiryWarningHtml() {
    if (!this.#config.checkExpiration) return '';
    if (!isPrescriptionExpired(this.#values.date)) return '';
    return `
      <p class="rx-prescription__notice rx-prescription__notice--warning" role="alert">
        This prescription looks older than 24 months. You can still continue, but we recommend an up-to-date prescription.
      </p>
    `;
  }

  #renderExpiryWarning() {
    const host = this.#body?.querySelector('[data-rx-expiry]');
    if (host) host.innerHTML = this.#expiryWarningHtml();
  }
}

if (!customElements.get('rx-prescription-drawer')) {
  customElements.define('rx-prescription-drawer', RxPrescriptionDrawer);
}

/**
 * Prescription CTA wrapper for the PDP. Stays hidden until a prescription-bearing
 * lens is chosen, and reflects whether one has already been captured. The button
 * itself opens the drawer declaratively via `on:click="#<drawer-id>/start"`.
 */
class RxPrescription extends Component {
  #state;
  #onChange = () => this.#reflect();

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

  #reflect() {
    const state = this.#state;
    const needsRx = state.visionType === 'single_vision' || state.visionType === 'progressive';
    this.hidden = !(needsRx && state.lensProduct);

    const method = state.prescription?.method;
    const done = Boolean(method) && method !== 'later';

    // Unified flow: the add-to-cart button opens the drawer, so the standalone
    // CTA only appears once a prescription exists (as the edit affordance).
    // Only the button hides — the drawer must stay renderable for showModal.
    const cta = this.querySelector('.rx-prescription__cta');
    if (cta instanceof HTMLElement) cta.hidden = !method;
    this.classList.toggle('rx-prescription--done', done || method === 'later');

    const label = this.querySelector('[data-rx-cta-label]');
    if (label) {
      if (done) label.textContent = this.dataset.editLabel || 'Edit prescription';
      else if (method === 'later') label.textContent = this.dataset.laterLabel || 'Add prescription later';
      else label.textContent = this.dataset.addLabel || 'Add prescription';
    }
  }
}

if (!customElements.get('rx-prescription')) {
  customElements.define('rx-prescription', RxPrescription);
}
