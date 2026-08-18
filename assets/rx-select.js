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

const { splitIntoColumns, lensOptionPair: pair } = await rxImport('rx-core.js');

/**
 * Two-column value picker for the prescription form.
 *
 * A native <select> makes a shopper scroll a single 160-item column to find
 * -2.75. This lays the range out in two columns instead, anchored on the value
 * people start from:
 *
 *   SPH / CYL   anchor 0   — plus side on the left, minus on the right
 *   PD          anchor 64  — smaller on the left, larger on the right (32 mono)
 *   ADD / AXIS  no anchor  — plain order, first half left, second half right
 *
 * Exposes `value` and fires a bubbling `change`, so the form reads it exactly
 * like the <select> it replaces.
 *
 * @extends {Component<{trigger: HTMLButtonElement, panel: HTMLElement}>}
 */
class RxSelect extends Component {
  requiredRefs = ['trigger', 'panel'];

  #open = false;
  #options = [];
  #layout = { head: [], left: [], right: [] };

  connectedCallback() {
    super.connectedCallback();

    try {
      this.#options = JSON.parse(this.dataset.options ?? '[]');
    } catch {
      this.#options = [];
    }
    this.#layout = splitIntoColumns(this.#options, {
      anchor: this.dataset.anchor === undefined ? null : Number(this.dataset.anchor),
      leftGoes: this.dataset.left === 'down' ? 'down' : 'up',
      split: this.dataset.split === 'halves' ? 'halves' : 'anchor',
    });

    this.#renderPanel();
    this.#renderTrigger();

    document.addEventListener('click', this.#onDocumentClick, true);
    this.addEventListener('keydown', this.#onKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this.#onDocumentClick, true);
    this.removeEventListener('keydown', this.#onKeydown);
  }

  /** The form reads and writes this the same way it did the <select>. */
  get value() {
    return this.getAttribute('value') ?? '';
  }

  set value(next) {
    const value = next == null ? '' : String(next);
    if (value === this.value) return;
    this.setAttribute('value', value);
    this.#renderTrigger();
    this.#markSelected();
  }

  toggle() {
    this.#open ? this.close() : this.open();
  }

  open() {
    if (this.#open) return;
    this.#open = true;
    this.refs.panel.hidden = false;
    this.refs.trigger.setAttribute('aria-expanded', 'true');
    this.#markSelected();
    // A picked value can sit far down a long list (axis runs to 180); with
    // nothing picked yet, centre on the value most people start from.
    const focal =
      this.querySelector('[aria-selected="true"]') ??
      (this.dataset.anchor ? this.querySelector(`[data-value="${CSS.escape(this.dataset.anchor)}"]`) : null);
    focal?.scrollIntoView({ block: 'center' });
  }

  close() {
    if (!this.#open) return;
    this.#open = false;
    this.refs.panel.hidden = true;
    this.refs.trigger.setAttribute('aria-expanded', 'false');
  }

  /** @param {{value?: string}} data */
  pick(data) {
    this.value = data?.value ?? '';
    this.close();
    this.refs.trigger.focus();
    this.dispatchEvent(new Event('change', { bubbles: true }));
  }

  #renderTrigger() {
    const chosen = this.#options.map(pair).find(([value]) => value === this.value);
    const label = chosen ? chosen[1] : this.dataset.placeholder || 'Select';
    this.refs.trigger.textContent = label;
    this.refs.trigger.classList.toggle('rx-select__trigger--empty', !this.value);
  }

  #renderPanel() {
    const { head, left, right } = this.#layout;
    const column = (options) =>
      `<div class="rx-select__column" role="none">${options.map((option) => this.#optionHtml(option)).join('')}</div>`;

    this.refs.panel.innerHTML = [
      head.length
        ? `<div class="rx-select__head" role="none">${head.map((option) => this.#optionHtml(option)).join('')}</div>`
        : '',
      column(left),
      column(right),
    ].join('');
  }

  #optionHtml(option) {
    const [value, label] = pair(option);
    return `
      <button
        type="button"
        class="rx-select__option"
        role="option"
        aria-selected="false"
        data-value="${escapeAttr(value)}"
        on:click="/pick?value=${encodeURIComponent(value)}"
      >${escapeAttr(label)}</button>
    `;
  }

  #markSelected() {
    for (const option of this.querySelectorAll('.rx-select__option')) {
      option.setAttribute('aria-selected', option.dataset.value === this.value ? 'true' : 'false');
    }
  }

  #onDocumentClick = (event) => {
    if (this.#open && !this.contains(/** @type {Node} */ (event.target))) this.close();
  };

  /** @param {KeyboardEvent} event */
  #onKeydown = (event) => {
    if (event.key === 'Escape' && this.#open) {
      event.stopPropagation(); // the drawer closes on Escape too
      this.close();
      this.refs.trigger.focus();
      return;
    }

    if (!this.#open && (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ')) {
      if (event.target === this.refs.trigger) {
        event.preventDefault();
        this.open();
      }
      return;
    }

    if (!this.#open) return;

    const options = [...this.querySelectorAll('.rx-select__option')];
    const index = options.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    const perColumn = this.#layout.left.length || 1;
    const moves = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      ArrowRight: index + perColumn,
      ArrowLeft: index - perColumn,
      Home: 0,
      End: options.length - 1,
    };

    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    options[Math.max(0, Math.min(options.length - 1, index < 0 ? 0 : next))]?.focus();
  };
}


function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

if (!customElements.get('rx-select')) {
  customElements.define('rx-select', RxSelect);
}
