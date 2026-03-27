/**
 * Expandable section: Read more / Read less toggle.
 * This is the only script for the expandable section. Wraps "more" blocks for
 * height animation and toggles expanded state on trigger click.
 */
(function () {
  /**
   * Wraps blocks after the preview in .expandable__more for expand/collapse animation.
   * @param {Element} expandable
   */
  function wrapMoreBlocks(expandable) {
    const blocksEl = expandable.querySelector('.expandable__blocks');
    if (!blocksEl || blocksEl.querySelector('.expandable__more')) return;

    const previewBlocks = parseInt(expandable.getAttribute('data-preview-blocks') || '2', 10);
    const children = Array.from(blocksEl.children);
    if (children.length <= previewBlocks) return;

    const moreNodes = children.slice(previewBlocks);
    moreNodes.forEach(function (node) {
      node.remove();
    });

    const moreInner = document.createElement('div');
    moreInner.className = 'expandable__more-inner';
    moreNodes.forEach(function (node) {
      moreInner.appendChild(node);
    });

    const more = document.createElement('div');
    more.className = 'expandable__more';
    more.appendChild(moreInner);
    blocksEl.appendChild(more);
  }

  function init() {
    document.querySelectorAll('.expandable').forEach(wrapMoreBlocks);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /**
   * @param {Event} event
   */
  function handleTriggerClick(event) {
    const target = /** @type {Element | null} */ (event.target);
    const trigger = target?.closest?.('[data-expandable-trigger]') ?? null;
    if (!trigger) return;

    const wrapper = trigger.closest('.expandable');
    const content = wrapper?.querySelector('[data-expandable-content]');
    if (!wrapper || !content) return;

    const expanded = wrapper.getAttribute('data-expanded') === 'true';
    const nextExpanded = !expanded;

    wrapper.setAttribute('data-expanded', String(nextExpanded));
    trigger.setAttribute('aria-expanded', String(nextExpanded));
    content.classList.toggle('expandable__content--collapsed', !nextExpanded);
  }

  document.addEventListener('click', handleTriggerClick);
})();
