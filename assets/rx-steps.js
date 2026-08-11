import { Component } from '@theme/component';

/**
 * Tabbed steps for `sections/rx-steps.liquid`.
 *
 * Tabs and the prev/next arrows drive one visible panel. Keyboard follows the
 * WAI-ARIA tabs pattern: arrows move between tabs, Home/End jump to the ends.
 *
 * @extends {Component<{tabs: HTMLElement[], panels: HTMLElement[]}>}
 */
class RxSteps extends Component {
  requiredRefs = ['tabs', 'panels'];

  #index = 0;

  connectedCallback() {
    super.connectedCallback();

    const selected = this.#tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    this.#index = selected < 0 ? 0 : selected;

    document.addEventListener('shopify:block:select', this.#onBlockSelect);
    this.#reflect();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('shopify:block:select', this.#onBlockSelect);
  }

  /**
   * Called after the Section Rendering API morphs this section back in. The
   * server always marks the first tab as selected, so re-apply what the shopper
   * had open — clamped, because a block may have been removed meanwhile.
   */
  updatedCallback() {
    super.updatedCallback();
    this.#go(this.#index);
  }

  get #tabs() {
    const tabs = this.refs.tabs;
    return Array.isArray(tabs) ? tabs : [];
  }

  get #panels() {
    const panels = this.refs.panels;
    return Array.isArray(panels) ? panels : [];
  }

  /** @param {{index?: number}} data */
  select(data) {
    this.#go(Number(data?.index ?? 0));
  }

  next() {
    this.#go(this.#index + 1);
  }

  prev() {
    this.#go(this.#index - 1);
  }

  /**
   * Tab-list keyboard navigation. Bound on the tablist, so the only elements
   * that can be focused when it fires are the tabs themselves.
   *
   * @param {KeyboardEvent} event
   */
  navigate(event) {
    let index;

    switch (event.key) {
      case 'ArrowRight':
        index = this.#index + 1;
        break;
      case 'ArrowLeft':
        index = this.#index - 1;
        break;
      case 'Home':
        index = 0;
        break;
      case 'End':
        index = this.#panels.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    this.#go(index, { focusTab: true });
  }

  /**
   * @param {number} index — wraps around both ends
   * @param {{focusTab?: boolean}} [options]
   */
  #go(index, options = {}) {
    const count = this.#panels.length;
    if (!count || Number.isNaN(index)) return;

    this.#index = ((index % count) + count) % count;
    this.#reflect();

    if (options.focusTab) this.#tabs[this.#index]?.focus();
  }

  #reflect() {
    this.#tabs.forEach((tab, index) => {
      const active = index === this.#index;
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
      tab.classList.toggle('rx-steps__tab--active', active);
    });

    this.#panels.forEach((panel, index) => {
      panel.hidden = index !== this.#index;
    });
  }

  /**
   * Picking a step in the theme editor sidebar highlights its tab but never
   * emits a click, so the panel would stay on whatever was open. `shopify:block:select`
   * is only ever dispatched inside the editor.
   *
   * @param {Event} event
   */
  #onBlockSelect = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const tab = target.closest('[role="tab"]');
    const index = tab ? this.#tabs.indexOf(/** @type {HTMLElement} */ (tab)) : -1;
    if (index >= 0) this.#go(index);
  };
}

if (!customElements.get('rx-steps')) {
  customElements.define('rx-steps', RxSteps);
}
