/**
 * RX core: pure state + prescription logic. No @theme imports, no DOM access —
 * safe to import in the browser and under `node --test`.
 *
 * Line-item property names below are a backend contract (see plan Global
 * Constraints) and must not be renamed.
 */

// --- State -----------------------------------------------------------------

export class RxState extends EventTarget {
  frame = null;          // {productId, variantId, sku, price, title, frameTag, baseCurveTag}
  lensCategory = null;   // 'clear' | 'sunglasses' | 'photochromic'
  visionType = null;     // 'single_vision' | 'progressive' | 'non_rx'
  lensProduct = null;    // {id, variantId, sku, price, title, color}
  prescription = { method: null, values: null, uniqueId: null, rxUID: null, expired: false };

  // Assign a field and notify subscribers.
  set(key, value) {
    this[key] = value;
    this.dispatchEvent(new CustomEvent('rx:change', { detail: { key, value, state: this } }));
  }

  // Ready to add to cart: lens fully chosen and a prescription path taken
  // (non-RX has no prescription).
  get isComplete() {
    if (!this.lensCategory || !this.visionType || !this.lensProduct) return false;
    if (this.visionType === 'non_rx') return true;
    return Boolean(this.prescription && this.prescription.method);
  }

  // Frame + lens, in cents.
  get totalPrice() {
    return (this.frame?.price || 0) + (this.lensProduct?.price || 0);
  }
}

// --- Prescription validation ----------------------------------------------

const EXPIRY_MONTHS = 24;

// Treat these placeholders as "no value entered".
function isBlank(value) {
  return value == null || value === '' || value === 'Select' || value === 'N/A';
}

function toNumber(value) {
  return isBlank(value) ? NaN : parseFloat(value);
}

function withinLimit(value, limit) {
  if (!limit) return true;
  const n = toNumber(value);
  if (Number.isNaN(n)) return true; // non-numeric ⇒ nothing to range-check
  if (limit.min != null && n < limit.min) return false;
  if (limit.max != null && n > limit.max) return false;
  return true;
}

// Parse ISO (YYYY-MM-DD) and MM/DD/YYYY-style dates.
function parseRxDate(dateStr) {
  if (isBlank(dateStr)) return null;
  const raw = String(dateStr).trim();

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const parts = raw.split(/[/.\-]/).map(Number);
  if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
    const [a, b, c] = parts;
    return a > 31 ? new Date(a, b - 1, c) : new Date(c, a - 1, b);
  }

  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// True when the prescription date is older than EXPIRY_MONTHS.
export function isPrescriptionExpired(dateStr, now = new Date()) {
  const date = parseRxDate(dateStr);
  if (!date) return false;
  const threshold = new Date(now);
  threshold.setMonth(threshold.getMonth() - EXPIRY_MONTHS);
  return date < threshold;
}

const RANGE_FIELDS = [
  ['sph_od', 'sph'], ['sph_os', 'sph'],
  ['cyl_od', 'cyl'], ['cyl_os', 'cyl'],
  ['axis_od', 'axis'], ['axis_os', 'axis'],
  ['add_od', 'add'], ['add_os', 'add'],
  ['pd', 'pd'], // monocular half-PD (pd_left/pd_right) isn't range-checked against the binocular limit
];

/**
 * Validate prescription values against numeric limits.
 * Expiry is reported separately — it warns but does not fail validation.
 * @returns {{valid: boolean, errors: Object, expired: boolean}}
 */
export function validatePrescription(values = {}, limits = {}, opts = { checkExpiration: true }) {
  const errors = {};

  for (const [field, limitKey] of RANGE_FIELDS) {
    if (!isBlank(values[field]) && !withinLimit(values[field], limits[limitKey])) {
      errors[field] = 'Value is out of range';
    }
  }

  // Pupillary distance: accept a single value or a left/right pair.
  const hasSinglePd = !isBlank(values.pd);
  const hasDualPd = !isBlank(values.pd_left) && !isBlank(values.pd_right);
  if (!hasSinglePd && !hasDualPd) {
    errors.pd = 'Pupillary distance is required';
  }

  // Cylinder and axis go together (cyl of 0 counts as no cylinder).
  const hasCyl = (v) => !isBlank(v) && toNumber(v) !== 0;
  for (const eye of ['od', 'os']) {
    const cyl = values[`cyl_${eye}`];
    const axis = values[`axis_${eye}`];
    if (hasCyl(cyl) && isBlank(axis)) errors[`axis_${eye}`] = 'Axis is required when cylinder is set';
    if (!isBlank(axis) && !hasCyl(cyl)) errors[`cyl_${eye}`] = 'Cylinder is required when axis is set';
  }

  const expired = opts && opts.checkExpiration === false ? false : isPrescriptionExpired(values.date);

  return { valid: Object.keys(errors).length === 0, errors, expired };
}

// --- OCR mapping -----------------------------------------------------------

// Drop a trailing "mm" unit and surrounding whitespace from a PD value.
function stripUnit(value) {
  return value == null ? value : String(value).replace(/\s*mm$/i, '').trim();
}

// Left-pad an axis to three digits (keeps only the leading integer part).
function padAxis(value) {
  const digits = String(value).replace(/[^\d]/g, '');
  return digits === '' ? '' : digits.padStart(3, '0');
}

/**
 * Map an OCR/ScriptAI `prescriptionData` payload onto the flat `values` shape
 * the manual form and validation use. OD = right eye, OS = left eye.
 * @param {Object} [prescriptionData]
 * @returns {Object} values (only the fields present in the input)
 */
export function mapOcrToValues(prescriptionData) {
  const d = prescriptionData || {};
  const values = {};

  const pairs = [
    ['sphRight', 'sph_od'], ['sphLeft', 'sph_os'],
    ['cylRight', 'cyl_od'], ['cylLeft', 'cyl_os'],
    ['addRight', 'add_od'], ['addLeft', 'add_os'],
  ];
  for (const [from, to] of pairs) {
    if (d[from] != null && d[from] !== '') values[to] = String(d[from]);
  }

  if (d.axisRight != null && d.axisRight !== '') values.axis_od = padAxis(d.axisRight);
  if (d.axisLeft != null && d.axisLeft !== '') values.axis_os = padAxis(d.axisLeft);

  // PD: a monocular left/right pair takes precedence over a single value.
  if (d.isMonocularPd && d.pdRight != null && d.pdLeft != null) {
    values.pd_right = stripUnit(d.pdRight);
    values.pd_left = stripUnit(d.pdLeft);
  } else if (d.pupillaryDistance != null) {
    values.pd = stripUnit(d.pupillaryDistance);
  } else if (d.pdValue != null) {
    values.pd = stripUnit(d.pdValue);
  }

  const iso = normalizeDateToIso(d.prescriptionDate || d.date);
  if (iso) values.date = iso;

  return values;
}

/**
 * Normalize a date string to the ISO YYYY-MM-DD form that <input type="date">
 * accepts. Handles ISO passthrough and the US MM/DD/YYYY the OCR returns.
 * Unparseable input yields '' so the field is simply left blank.
 */
export function normalizeDateToIso(str) {
  if (!str) return '';
  const s = String(str).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return '';
}

// --- Line-item properties --------------------------------------------------

// Human-facing labels shown in the cart.
const LENS_STYLE_LABELS = { clear: 'Clear', sunglasses: 'Sunglasses', photochromic: 'Photochromic' };
const RX_STYLE_LABELS = { single_vision: 'SV', progressive: 'Progressive', non_rx: 'Non-RX' };

/**
 * Build cart line-item properties for the lens + frame bundle.
 * @param {RxState} state
 * @param {{subdomain?: string, providerNumber?: string, healthFundNumbers?: string}} config
 * @returns {{bundleHash: string, lensProperties: Object, frameProperties: Object}}
 */
export function buildLineItemProperties(state, config = {}) {
  const frame = state.frame || {};
  const lens = state.lensProduct || {};
  const rx = state.prescription || {};
  const values = rx.values || {};

  const bundleHash = `bundle-hash-${Date.now()}-${lens.variantId}-${frame.variantId}`;

  // A uniqueId means an uploaded/scanned file; otherwise manual or a deferred RX.
  const prescriptionType = rx.uniqueId ? 'file' : (rx.method === 'manual' ? 'manual' : 'pending');

  const lensProperties = {
    _bundleHash: bundleHash,
    rxOrder: 'true',
    _prescription_type: prescriptionType,
    'RX Style': RX_STYLE_LABELS[state.visionType] || 'SV',
    'Lens Style': LENS_STYLE_LABELS[state.lensCategory] || 'Clear',
    'Provider number': config.providerNumber || '',
    'Health Fund Item Numbers': config.healthFundNumbers || '',
    'Frame SKU': frame.sku || '',
    'Lens SKU': lens.sku || '',
    _frame_variant_id: frame.variantId,
  };

  if (rx.uniqueId) lensProperties.uniqueId = rx.uniqueId;
  if (rx.rxUID) lensProperties['Prescription RX UID'] = rx.rxUID;

  // PD: a left/right pair takes precedence over a single value.
  if (!isBlank(values.pd_left) && !isBlank(values.pd_right)) {
    lensProperties['Pupillary Distance Left'] = `${values.pd_left}mm`;
    lensProperties['Pupillary Distance Right'] = `${values.pd_right}mm`;
  } else if (!isBlank(values.pd)) {
    lensProperties['Pupillary Distance'] = `${values.pd}mm`;
  }

  if (rx.expired) lensProperties.expiredRX = 'true';

  const frameProperties = {
    _bundleHash: bundleHash,
    'Frame SKU': frame.sku || '',
    'Lens SKU': lens.sku || '',
  };

  return { bundleHash, lensProperties, frameProperties };
}

/**
 * Power tier for a prescription: 'high' when either eye's sphere exceeds the
 * threshold (exclusive), else 'standard'. Lenses are priced per tier.
 * @param {object|null} values - prescription values (sph_od/sph_os as strings)
 * @param {number} threshold - absolute SPH bound of the standard range
 */
export function pickTier(values, threshold = 2) {
  if (!values) return 'standard';
  const powers = [values.sph_od, values.sph_os]
    .map((v) => Math.abs(parseFloat(v)))
    .filter((v) => !Number.isNaN(v));
  return powers.some((v) => v > threshold) ? 'high' : 'standard';
}

/**
 * Pick the lens catalog entry for a vision type, color and power tier.
 * Entries without a tier (or tier 'any') match every tier; an exact tier match
 * wins, then 'any', then 'standard' as the last resort.
 */
export function resolveLensProduct(products = [], { visionType, color = null, tier = 'standard' } = {}) {
  const vision = visionType === 'non_rx' ? 'single_vision' : visionType;
  const candidates = products.filter(
    (p) => p.visionType === vision && (color == null ? p.color == null : p.color === color)
  );
  const byTier = (t) => candidates.find((p) => (p.tier ?? 'any') === t);
  return byTier(tier) ?? byTier('any') ?? byTier('standard') ?? null;
}


/**
 * Format cents in the storefront's active currency (falls back to USD).
 * @param {number} cents
 * @param {string} [currency]
 */
export function formatCents(cents, currency) {
  const active = currency || globalThis.Shopify?.currency?.active || 'USD';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: active }).format((cents || 0) / 100);
  } catch {
    return `$${((cents || 0) / 100).toFixed(2)}`;
  }
}

/**
 * Lens color name → lensgen color slug ("Grey Polar Mirror Blue" →
 * "grey-polar-mirror-blue", "Clear + AR" → "clear-ar").
 */
export function lensColorSlug(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Stable image URL for recolor caching: strip responsive size params (width,
 * height) so the same product+color always hits the same cache key.
 */
export function stripImageSizeParams(url) {
  if (!url) return '';
  try {
    const u = new URL(url, 'https://x.invalid');
    u.searchParams.delete('width');
    u.searchParams.delete('height');
    const qs = u.searchParams.toString();
    return url.split('?')[0] + (qs ? `?${qs}` : '');
  } catch {
    return url;
  }
}
