/**
 * Yotpo Reviews – Combined Listing Sync + Zero-Review Hiding.
 */

(function () {
  'use strict';

  var WIDGET_SEL      = '.yotpo-widget-instance';
  var APP_BLOCK_SEL   = '.shopify-app-block';
  var EMPTY_STATE_SEL = '.yotpo-empty-state';
  var WATCHING_ATTR   = 'data-otis-watching';

  // ZERO-REVIEW HIDING

  function syncEmptyState() {
    document.querySelectorAll(WIDGET_SEL).forEach(function (widget) {
      var hasEmpty = !!widget.querySelector(EMPTY_STATE_SEL);
      var wrapper  = widget.closest(APP_BLOCK_SEL) || widget;

      if (hasEmpty) {
        wrapper.style.display = 'none';
      } else if (widget.children.length > 0) {
        wrapper.style.display = '';
      }
    });
  }

  function observeAppBlocks() {
    var blocks  = document.querySelectorAll(APP_BLOCK_SEL);
    var targets = blocks.length ? Array.prototype.slice.call(blocks) : [document.body];

    targets.forEach(function (target) {
      if (target.hasAttribute(WATCHING_ATTR)) return;
      target.setAttribute(WATCHING_ATTR, '');

      new MutationObserver(function () {
        requestAnimationFrame(syncEmptyState);
      }).observe(target, {
        childList:  true,
        subtree:    true,
        attributes: true,
      });
    });
  }

  function scheduleHidingChecks() {
    syncEmptyState();
    [300, 800, 2000, 5000, 10000].forEach(function (ms) {
      setTimeout(syncEmptyState, ms);
    });
  }

  // COMBINED LISTINGS SYNC

  function readPrimaryProductId() {
    var dataEl = document.getElementById('yotpo-primary-data');
    if (!dataEl) return '';
    try {
      var parsed = JSON.parse(dataEl.textContent || '{}');
      return String(parsed.primaryProductId || '').trim();
    } catch (e) {
      return '';
    }
  }

  var primaryProductId = readPrimaryProductId();

  function findYotpoApi() {
    var candidates = ['yotpo', 'Yotpo', 'yotpoWidgetsContainer', 'YotpoWidgetsContainer'];
    for (var i = 0; i < candidates.length; i++) {
      var api = window[candidates[i]];
      if (api && (typeof api.refreshWidgets === 'function' || typeof api.initWidgets === 'function')) {
        return api;
      }
    }
    return null;
  }

  function callYotpoRefresh() {
    var api = findYotpoApi();
    if (!api) return false;
    if (typeof api.refreshWidgets === 'function') {
      api.refreshWidgets();
    } else {
      api.initWidgets();
    }
    return true;
  }

  function syncYotpoToProduct(productId) {
    document.querySelectorAll(WIDGET_SEL).forEach(function (widget) {
      if (!widget.getAttribute('data-yotpo-product-id')) return;
      widget.setAttribute('data-yotpo-product-id', productId);
      widget.removeAttribute('data-yotpo-element-loaded');
      widget.removeAttribute('data-yotpo-element-initialized');
    });
    callYotpoRefresh();
  }

  function waitForYotpoThenSync(productId) {
    var MAX_MS   = 15000;
    var CHECK_MS = 250;
    var elapsed  = 0;

    var timer = setInterval(function () {
      elapsed += CHECK_MS;
      if (findYotpoApi()) {
        clearInterval(timer);
        if (productId) syncYotpoToProduct(productId);
        else callYotpoRefresh();
      } else if (elapsed >= MAX_MS) {
        clearInterval(timer);
      }
    }, CHECK_MS);
  }

  // ENTRY POINT

  function init() {
    if (primaryProductId) {
      document.querySelectorAll(WIDGET_SEL).forEach(function (widget) {
        var oldId = widget.getAttribute('data-yotpo-product-id');
        if (oldId && oldId !== primaryProductId) {
          widget.setAttribute('data-yotpo-product-id', primaryProductId);
          widget.removeAttribute('data-yotpo-element-loaded');
          widget.removeAttribute('data-yotpo-element-initialized');
        }
      });
    }

    observeAppBlocks();
    scheduleHidingChecks();

    if (findYotpoApi()) {
      if (primaryProductId) syncYotpoToProduct(primaryProductId);
      else callYotpoRefresh();
    } else {
      waitForYotpoThenSync(primaryProductId);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // COMBINED LISTING NAVIGATION

  document.addEventListener('variant:update', function (event) {
    var newProduct =
      event &&
      event.detail &&
      event.detail.data &&
      event.detail.data.newProduct;

    if (!newProduct) return;

    requestAnimationFrame(function () {
      primaryProductId = readPrimaryProductId();

      document.querySelectorAll('[' + WATCHING_ATTR + ']').forEach(function (el) {
        el.removeAttribute(WATCHING_ATTR);
      });
      observeAppBlocks();

      if (!primaryProductId) {
        callYotpoRefresh();
        [500, 1500, 3000].forEach(function (ms) { setTimeout(syncEmptyState, ms); });
        return;
      }

      syncYotpoToProduct(primaryProductId);

      [300, 800, 2000].forEach(function (ms) {
        setTimeout(function () {
          var hasWrong = Array.prototype.some.call(
            document.querySelectorAll(WIDGET_SEL),
            function (w) {
              var id = w.getAttribute('data-yotpo-product-id');
              return id && id !== primaryProductId;
            }
          );
          if (hasWrong) syncYotpoToProduct(primaryProductId);
          syncEmptyState();
        }, ms);
      });
    });
  });
})();
