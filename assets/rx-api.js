/**
 * RX App Proxy client: a thin fetch layer over the EazyVisi endpoints exposed
 * through Shopify App Proxy (/apps/proxy/*). Shopify signs the requests
 * server-side, so there is no client HMAC. No @theme imports — importable in
 * the browser and under `node --test`.
 */

const PROXY_BASE = '/apps/proxy';

// Thrown on any non-2xx (or network-level) proxy failure; carries the status.
export class RxApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'RxApiError';
    this.status = status;
  }
}

// Extract a useful message from a failed response (JSON {message}/{error} or raw text).
async function readError(response) {
  const text = await response.text().catch(() => '');
  if (text) {
    try {
      const data = JSON.parse(text);
      return data.message || data.error || text;
    } catch {
      return text;
    }
  }
  return `Request failed (${response.status})`;
}

// Run a request and return parsed JSON; map any failure to RxApiError.
async function request(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    throw new RxApiError(err?.message || 'Network request failed', 0);
  }
  if (!response.ok) {
    throw new RxApiError(await readError(response), response.status);
  }
  return response.json();
}

// Unwrap the backend's {success, data:{...}} envelope when present.
function unwrap(json) {
  return json && json.data != null ? json.data : json;
}

// POST JSON to an action; the action name is echoed in the body per backend contract.
function postJson(action, payload = {}) {
  return request(`${PROXY_BASE}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
}

// GET an action with query params (action is echoed as a param too). Relative
// URL keeps this node-testable without a window.location origin.
function getQuery(action, params = {}) {
  const search = new URLSearchParams({ action });
  for (const [key, value] of Object.entries(params)) {
    if (value != null) search.append(key, String(value));
  }
  return request(`${PROXY_BASE}/${action}?${search.toString()}`, { method: 'GET' });
}

/**
 * OCR a prescription image/PDF. Sends multipart FormData so the browser sets
 * the boundary — do not add a Content-Type header.
 * @param {Blob|File} file
 * @returns {Promise<{success, prescriptionData, uniqueId, analysis, rxUID}>}
 */
export async function analyzePrescription(file) {
  const formData = new FormData();
  formData.append('action', 'analyze-prescription');
  formData.append('prescription', file);

  const result = await request(`${PROXY_BASE}/analyze-prescription`, {
    method: 'POST',
    body: formData,
  });
  const data = result.data || result;
  return {
    success: result.success ?? data.success ?? true,
    prescriptionData: data.prescriptionData,
    uniqueId: data.uniqueId ?? data.unique_id,
    analysis: data.analysis,
    rxUID: data.rxUID,
  };
}

// Persist a prescription. Payload carries order/line-item ids and RX values.
export async function savePrescription(payload) {
  return unwrap(await postJson('save-prescription', payload));
}

// Fetch an order (params e.g. {orderId}) for the my-orders page.
export async function getOrder(params) {
  return unwrap(await getQuery('get-order', params));
}

// Resolve a stored prescription file to a viewable URL.
export async function getPrescriptionFile(uniqueId) {
  return unwrap(await getQuery('get-prescription-file', { uniqueId }));
}

// Write RX properties back onto an existing order line item. Caller includes subdomain.
export async function updateLineItemProperties(payload) {
  return unwrap(await postJson('update-line-item-properties', payload));
}

