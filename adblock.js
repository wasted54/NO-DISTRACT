/* No Distract by Wasted — adblock.js
 * Runs on every site. Four independent things happen here:
 *
 * 1. Banner/companion ad iframes (adBlock setting) — a cosmetic
 *    backstop for the network-level declarativeNetRequest ruleset (see
 *    background.js / rules.json), which does the actual heavy lifting
 *    and needs no page script at all.
 *
 * 2. Promotional popup/modal overlays (blockPopups setting) — the
 *    "Enroll now! 690+ students scored above 90%!" style interstitial
 *    that covers the page and has to be manually closed. There's no
 *    reliable selector for these across different sites, so this is a
 *    best-effort heuristic: an element only gets hidden if it's
 *    positioned as an overlay (fixed/absolute + high z-index), covers a
 *    meaningful chunk of the viewport, AND either matches common
 *    promo/marketing wording or has both a close control and is large.
 *    Because it's a heuristic, it's a separate toggle from the more
 *    precise ad blocking above — turn it off if a site's own popup
 *    (login, cart, image viewer, etc.) ever gets caught by mistake.
 *
 * 3. Dark Reader-style universal dark mode (darkReader setting) — the
 *    actual filter is defined in dark-mode.css; this file just keeps
 *    the data-ns-dark attribute that CSS gates on in sync with the
 *    saved setting.
 *
 * 4. Black & white mode (bwMode setting) — a plain grayscale filter,
 *    defined in bw-mode.css, gated on data-ns-bw. Unlike dark mode this
 *    needs no "is the page already X" check — grayscale is safe to
 *    apply unconditionally — and it combines cleanly with dark mode if
 *    both are on at once (see bw-mode.css for how).
 */

(function () {
  "use strict";

  const DEFAULT_SETTINGS = {
    hideSidebar: false,
    hideGuide: false,
    homeFeedFilter: false,
    masterEnabled: true,
    blockShorts: false,
    adBlock: false,
    blockPopups: false,
    darkReader: false,
    bwMode: false,
  };

  // Master switch: when off, every feature behaves as if disabled.
  function effectiveSettings(saved) {
    const merged = { ...DEFAULT_SETTINGS, ...saved };
    if (merged.masterEnabled === false) {
      Object.assign(merged, { hideSidebar: false, hideGuide: false, homeFeedFilter: false, blockShorts: false, adBlock: false, blockPopups: false, darkReader: false, bwMode: false });
    }
    return merged;
  }

  const AD_HIDE_CLASS = "ns-ad-hide";
  const POPUP_HIDE_CLASS = "ns-popup-hide";

  const AD_ELEMENT_SELECTORS = [
    'iframe[src*="doubleclick.net"]',
    'iframe[src*="googlesyndication.com"]',
    "ins.adsbygoogle",
    '[id^="google_ads_iframe"]',
    '[id^="div-gpt-ad"]',
  ];

  // Only inspect elements that already look modal-ish, rather than
  // scanning every node on the page (expensive, and much noisier).
  const POPUP_CANDIDATE_SELECTOR = [
    '[class*="modal" i]',
    '[class*="popup" i]',
    '[class*="overlay" i]',
    '[class*="backdrop" i]',
    '[class*="dimmer" i]',
    '[id*="modal" i]',
    '[id*="popup" i]',
    '[role="dialog"]',
    '[aria-modal="true"]',
  ].join(", ");

  const PROMO_KEYWORDS =
    /enroll now|book (a |your )?demo|limited time|sign ?up now|subscribe now|claim (your )?offer|% off|free trial|download now|outstanding results|scored above|get started free|unlock (now|offer)|special offer|exclusive deal|act now|don'?t miss/i;

  let adBlockEnabled = DEFAULT_SETTINGS.adBlock;
  let popupsEnabled = DEFAULT_SETTINGS.blockPopups;
  let darkReaderEnabled = DEFAULT_SETTINGS.darkReader;
  let bwModeEnabled = DEFAULT_SETTINGS.bwMode;

  // The invert+hue-rotate trick can't tell "this site is already dark"
  // from "this site is light" — forcing it on an already-dark site
  // (YouTube Music, Twitter dark mode, etc.) just washes it out toward
  // white instead of leaving it alone. So: walk up from whatever
  // element is actually visible at the center of the screen, find the
  // first non-transparent background color, and measure its
  // luminance. If the page already reads as dark, skip the filter.
  function pageLooksDark() {
    let el;
    try {
      el = document.elementFromPoint(
        Math.floor(window.innerWidth / 2),
        Math.floor(window.innerHeight / 2)
      );
    } catch (err) {
      el = null;
    }

    while (el) {
      const bg = window.getComputedStyle(el).backgroundColor;
      const nums = bg && bg.match(/[\d.]+/g);
      if (nums && nums.length >= 3) {
        const [r, g, b] = nums.map(Number);
        const alpha = nums.length >= 4 ? nums[3] : 1;
        if (alpha > 0.5) {
          const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          return luminance < 0.4;
        }
      }
      el = el.parentElement;
    }
    return false; // couldn't determine a real background — assume light
  }

  function applyAttribute() {
    document.documentElement.setAttribute(
      "data-ns-adblock",
      adBlockEnabled ? "on" : "off"
    );
    const effectiveDark = darkReaderEnabled && !pageLooksDark();
    document.documentElement.setAttribute(
      "data-ns-dark",
      effectiveDark ? "on" : "off"
    );
    document.documentElement.setAttribute(
      "data-ns-bw",
      bwModeEnabled ? "on" : "off"
    );
  }

  function scheduleDarkRecheck() {
    // Re-run the dark-background check a few times as the page
    // finishes rendering — checking only once, especially at
    // document_start, can catch the page before its real background
    // has painted yet.
    [0, 300, 900, 2000].forEach((delay) => {
      window.setTimeout(() => {
        if (darkReaderEnabled) applyAttribute();
      }, delay);
    });
  }

  function restoreScroll() {
    [document.documentElement, document.body].forEach((node) => {
      if (node && node.style && node.style.overflow === "hidden") {
        node.style.overflow = "";
      }
    });
  }

  // Selector for known video player containers — YouTube's player (and
  // most other sites' players) is full of legitimate elements with
  // "overlay" in the class name (thumbnail overlay, gradient overlays,
  // caption overlays, ad overlays, etc.), which is exactly the pattern
  // the popup heuristic looks for. Without this exclusion, polling
  // every 700ms could repeatedly grab and hide part of the player,
  // fighting with the site's own re-rendering and looking like the
  // video keeps reloading/restarting.
  const PLAYER_CONTAINER_SELECTOR =
    "#movie_player, .html5-video-player, ytd-player, #player-container, #player, #ytd-player, video";

  function classifyOverlay(el) {
    if (!(el instanceof HTMLElement)) return null;
    if (el.id === "ns-focus-banner" || el.closest("#ns-focus-banner")) {
      return null; // never touch our own UI
    }
    if (el.closest(PLAYER_CONTAINER_SELECTOR)) return null;
    if (el.querySelector("video")) return null;

    // Cheap size check first — filters out the vast majority of
    // candidates before touching getComputedStyle at all, which forces
    // a style/layout computation and is comparatively expensive to run
    // on every element matching the broad modal/popup/overlay selector.
    const rect = el.getBoundingClientRect();
    if (rect.width < 150 || rect.height < 100) return null;

    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") {
      return null;
    }
    if (style.position !== "fixed" && style.position !== "absolute") {
      return null;
    }

    const z = parseInt(style.zIndex, 10);
    if (isNaN(z) || z < 100) return null;

    const viewportArea = window.innerWidth * window.innerHeight;
    if (viewportArea <= 0) return null;
    const areaRatio = (rect.width * rect.height) / viewportArea;

    const idClass = ((el.id || "") + " " + (el.className || "")).toLowerCase();

    // Near-fullscreen dim layer sitting behind a dialog.
    if (
      areaRatio > 0.75 &&
      /backdrop|overlay-bg|modal-overlay|dimmer|scrim/.test(idClass)
    ) {
      return "backdrop";
    }

    if (areaRatio < 0.12) return null;

    const text = (el.innerText || "").slice(0, 600);
    const hasCloseControl = !!el.querySelector(
      '[aria-label*="close" i], [class*="close" i], [id*="close" i]'
    );
    const keywordMatch = PROMO_KEYWORDS.test(text);

    if (keywordMatch || (hasCloseControl && areaRatio > 0.25)) {
      return "popup";
    }

    return null;
  }

  function sweepAds(root) {
    if (!adBlockEnabled) return;
    AD_ELEMENT_SELECTORS.forEach((sel) => {
      root
        .querySelectorAll(sel)
        .forEach((el) => el.classList.add(AD_HIDE_CLASS));
    });
  }

  function sweepPopups(root) {
    if (!popupsEnabled) return;
    root.querySelectorAll(POPUP_CANDIDATE_SELECTOR).forEach((el) => {
      if (el.classList.contains(POPUP_HIDE_CLASS)) return;
      const kind = classifyOverlay(el);
      if (kind === "popup" || kind === "backdrop") {
        el.classList.add(POPUP_HIDE_CLASS);
        restoreScroll();
      }
    });
  }

  function unhideAdClass() {
    document
      .querySelectorAll("." + AD_HIDE_CLASS)
      .forEach((el) => el.classList.remove(AD_HIDE_CLASS));
  }

  function unhidePopupClass() {
    document
      .querySelectorAll("." + POPUP_HIDE_CLASS)
      .forEach((el) => el.classList.remove(POPUP_HIDE_CLASS));
  }

  function sweep(root) {
    sweepAds(root);
    sweepPopups(root);
  }

  let sweepScheduled = false;

  function scheduleSweep() {
    if (sweepScheduled) return;
    sweepScheduled = true;
    window.requestAnimationFrame(() => {
      sweepScheduled = false;
      sweep(document);
    });
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.addedNodes && m.addedNodes.length > 0) {
        scheduleSweep();
        break;
      }
    }
  });

  let popupPollTimer = null;

  function startPopupPolling() {
    if (popupPollTimer) return;
    // Many promo popups appear after a delay (setTimeout) rather than
    // in direct response to a user action, and some sites re-apply
    // their scroll lock shortly after opening — polling catches both
    // more reliably than relying on mutation timing alone.
    popupPollTimer = window.setInterval(() => {
      sweepPopups(document);
    }, 1200);
  }

  function stopPopupPolling() {
    if (!popupPollTimer) return;
    window.clearInterval(popupPollTimer);
    popupPollTimer = null;
  }

  function start() {
    sweep(document);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    if (popupsEnabled) startPopupPolling();
    if (darkReaderEnabled) scheduleDarkRecheck();
  }

  chrome.storage.sync.get({ nsSettings: DEFAULT_SETTINGS }, (res) => {
    const settings = effectiveSettings(res.nsSettings);
    adBlockEnabled = !!settings.adBlock;
    popupsEnabled = !!settings.blockPopups;
    darkReaderEnabled = !!settings.darkReader;
    bwModeEnabled = !!settings.bwMode;
    applyAttribute();

    if (document.documentElement) {
      start();
    } else {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.nsSettings) return;
    const newSettings = effectiveSettings(changes.nsSettings.newValue);

    const wasAdEnabled = adBlockEnabled;
    adBlockEnabled = !!newSettings.adBlock;
    if (wasAdEnabled && !adBlockEnabled) {
      unhideAdClass();
    } else if (!wasAdEnabled && adBlockEnabled) {
      sweepAds(document);
    }

    const wasPopupsEnabled = popupsEnabled;
    popupsEnabled = !!newSettings.blockPopups;
    if (wasPopupsEnabled && !popupsEnabled) {
      unhidePopupClass();
      stopPopupPolling();
    } else if (!wasPopupsEnabled && popupsEnabled) {
      sweepPopups(document);
      startPopupPolling();
    }

    const wasDarkReaderEnabled = darkReaderEnabled;
    darkReaderEnabled = !!newSettings.darkReader;
    bwModeEnabled = !!newSettings.bwMode;
    applyAttribute();
    if (!wasDarkReaderEnabled && darkReaderEnabled) {
      scheduleDarkRecheck();
    }
  });
})();
