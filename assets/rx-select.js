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
// Panel geometry, in px: never narrower than this if the window allows, never
// taller than this, and this far clear of the field and of the window edges.
const MIN_WIDTH = 140;
const MAX_HEIGHT = 240;
const GAP = 2;
const EDGE = 12;

class RxSelect extends Component {
  requiredRefs = ['trigger', 'panel'];

  #open = false;
  #dropUp = null;
  #options = [];
  #layout = { head: [], left: [], right: [] };
  /** The scroller the field lives in, resolved on open. @type {Element | null} */
  #scroller = null;

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

    // The list is a popover so it paints in the top layer: the scrolling drawer
    // body can't clip it, the dialog's `overflow: hidden` can't crop it, and it
    // is positioned against the viewport even though the dialog carries a
    // transform mid-animation. Manual rather than auto — dismissal, Escape and
    // "only one list open" are handled below and stay as they were.
    const { panel } = this.refs;
    panel.removeAttribute('hidden');
    panel.setAttribute('popover', 'manual');

    document.addEventListener('click', this.#onDocumentClick, true);
    this.addEventListener('keydown', this.#onKeydown);
  }

  disconnectedCallback() {
    // The drawer replaces the whole step on re-render; drop the window
    // listeners with it.
    this.close();
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
    this.#scroller = this.closest('.rx-prescription-drawer__body');
    this.#showPanel(true);
    this.refs.trigger.setAttribute('aria-expanded', 'true');
    this.#placePanel();
    // Anchored to the viewport, so it has to follow the field as the drawer
    // scrolls — capture, because the scroller is the drawer body, not the page.
    window.addEventListener('scroll', this.#placePanel, true);
    window.addEventListener('resize', this.#placePanel);
    this.#markSelected();
    // A picked value can sit far down a long list (axis runs to 180); with
    // nothing picked yet, centre on the value most people start from. The
    // anchor is compared numerically — it is written '64' but listed as '64.0'.
    //
    // Scrolled by hand rather than with scrollIntoView: that walks every
    // scrollable ancestor, and the drawer body is one of them — it would drag
    // the whole form out of view instead of just moving the list.
    const focal = this.querySelector('[aria-selected="true"]') ?? this.#anchorOption();
    if (focal instanceof HTMLElement) {
      const panel = this.refs.panel;
      panel.scrollTop = focal.offsetTop - panel.clientHeight / 2 + focal.offsetHeight / 2;
    }
  }

  close() {
    if (!this.#open) return;
    this.#open = false;
    this.#dropUp = null;
    this.#showPanel(false);
    this.refs.trigger.setAttribute('aria-expanded', 'false');
    window.removeEventListener('scroll', this.#placePanel, true);
    window.removeEventListener('resize', this.#placePanel);
  }

  // showPopover/hidePopover throw when the panel is already in that state, and
  // the browser drops a popover from the top layer on its own when the element
  // leaves the document — which is exactly what a step re-render does.
  #showPanel(show) {
    const panel = this.refs.panel;
    try {
      show ? panel.showPopover() : panel.hidePopover();
    } catch {
      // already open / already closed
    }
  }

  // Anchors the panel to the field in viewport coordinates — correct because a
  // popover is laid out against the viewport whatever sits above it in the
  // tree. Drops upwards when the space below runs out.
  #placePanel = () => {
    const panel = this.refs.panel;
    const box = this.refs.trigger.getBoundingClientRect();

    // The field scrolls with the drawer body; once it has left that window the
    // panel would hang over the header, so close rather than follow.
    const clip = this.#scroller?.getBoundingClientRect();
    if (clip && (box.bottom <= clip.top || box.top >= clip.bottom)) {
      this.close();
      return;
    }

    // Never narrower than the field, and it only ever grows rightwards, so the
    // left edges stay flush and the panel can't be pushed past the window.
    const room = window.innerWidth - EDGE - box.left;
    panel.style.width = `${Math.ceil(Math.max(box.width, Math.min(MIN_WIDTH, room)))}px`;

    // Height the list would like, measured at that width — a two-option list
    // shouldn't flip upwards just because a 240px one wouldn't fit.
    const wanted = Math.min(MAX_HEIGHT, panel.scrollHeight + 2);
    const below = window.innerHeight - box.bottom - GAP - EDGE;
    const above = box.top - GAP - EDGE;

    // Decided once per opening: re-deciding on every scroll tick makes the list
    // jump across the field the moment it crosses the threshold.
    this.#dropUp ??= below < wanted && above > below;
    const up = this.#dropUp;

    panel.style.left = `${box.left}px`;
    panel.style.maxHeight = `${Math.round(Math.min(MAX_HEIGHT, Math.max(0, up ? above : below)))}px`;
    panel.style.top = up ? 'auto' : `${box.bottom + GAP}px`;
    panel.style.bottom = up ? `${window.innerHeight - box.top + GAP}px` : 'auto';
  };


  /**
   * The value is read off the clicked option rather than passed through the
   * binding: the theme's parser coerces numeric-looking parameters, which
   * turns '+0.25' into 0.25 and '090' into 90 — neither matches an option.
   *
   * @param {Event} event
   */
  pick(event) {
    const target = event.target;
    const option = target instanceof Element ? target.closest('.rx-select__option') : null;
    if (!option) return;

    this.value = option.getAttribute('data-value') ?? '';
    this.close();
    this.refs.trigger.focus();
    this.dispatchEvent(new Event('change', { bubbles: true }));
  }

  #anchorOption() {
    const anchor = Number(this.dataset.anchor);
    if (Number.isNaN(anchor)) return null;
    return (
      [...this.querySelectorAll('.rx-select__option')].find(
        (option) => parseFloat(option.getAttribute('data-value') ?? '') === anchor
      ) ?? null
    );
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
        on:click="/pick"
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
