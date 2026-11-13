/* No Distract by Wasted — content.js (YouTube only)
 * Reads saved settings (chrome.storage.sync, key "nsSettings") and, for
 * each enabled feature:
 *   - hideSidebar:     removes the right-hand "up next" feed on watch
 *                       pages
 *   - hideGuide:       hides the left-hand navigation menu (Home,
 *                       Subscriptions, You, etc.)
 *   - homeFeedFilter:  hides every home-feed card/shelf except videos
 *                       you're already partway through ("Continue
 *                       watching"), and replaces the rest of the home
 *                       page (filter chips, "Explore more topics", the
 *                       grid) with a centered "No Distraction is ON"
 *                       focus screen
 *   - blockShorts:     hides Shorts shelves/cards/nav and redirects\n *                       /shorts/ links to the normal player\n *   - adBlock:         (shared with adblock.js, which runs on every
 *                       site) hides YouTube's banner/companion/in-feed
 *                       ad units and auto-skips or fast-forwards
 *                       in-video ads
 *
 * The top bar (logo, search, mic) is always kept visible, overriding
 * YouTube's own auto-hide-on-scroll behavior — this isn't a toggle,
 * just permanent behavior (see hide-shorts.css).
 *
 * Elements are hidden by adding an ns-hide-* class (not by removing
 * them from the DOM), so turning a feature back off in the popup
 * restores them instantly without needing a page reload. CSS :has()
 * rules in hide-shorts.css handle the fast first pass; the
 * MutationObserver below is the backstop for anything added to the DOM
 * afterward that :has() alone would miss.
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
  function effective(s) {
    const merged = { ...DEFAULT_SETTINGS, ...s };
    if (merged.masterEnabled === false) {
      Object.assign(merged, { hideSidebar: false, hideGuide: false, homeFeedFilter: false, blockShorts: false, adBlock: false, blockPopups: false, darkReader: false, bwMode: false });
    }
    return merged;
  }

  let settings = { ...DEFAULT_SETTINGS };

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get({ nsSettings: DEFAULT_SETTINGS }, (res) => {
        resolve(effective(res.nsSettings));
      });
    });
  }

  function applyAttributes() {
    const root = document.documentElement;
    root.setAttribute("data-ns-sidebar", settings.hideSidebar ? "on" : "off");
    root.setAttribute("data-ns-guide", settings.hideGuide ? "on" : "off");
    root.setAttribute("data-ns-shorts", settings.blockShorts ? "on" : "off");
    root.setAttribute(
      "data-ns-homefeed",
      settings.homeFeedFilter ? "on" : "off"
    );
  }

  document.addEventListener(
    "yt-navigate-finish",
    () => {
      runCleanup();
    },
    true
  );

  /* ---------------- 2. Shared selectors for non-Shorts features ---------------- */

  const SECONDARY_FEED_SELECTORS = [
    "ytd-watch-next-secondary-results-renderer",
    "ytd-compact-autoplay-renderer",
  ];

  const GUIDE_SELECTORS = [
    "tp-yt-app-drawer#guide",
    "ytd-mini-guide-renderer",
  ];

  const HOME_ITEM_SELECTORS = ["ytd-rich-item-renderer"];
  const HOME_SHELF_SELECTORS = ["ytd-rich-shelf-renderer"];
  const RESUME_OVERLAY_SELECTOR =
    "ytd-thumbnail-overlay-resume-playback-renderer";

  const HIDE_SIDEBAR_CLASS = "ns-hide-sidebar";
  const HIDE_GUIDE_CLASS = "ns-hide-guide";
  const HIDE_HOMEFEED_CLASS = "ns-hide-homefeed";

  function unhideAll(className) {
    document
      .querySelectorAll("." + className)
      .forEach((el) => el.classList.remove(className));
  }

  function removeSecondaryFeed(root) {
    if (!settings.hideSidebar) return;
    if (!root.querySelector || !root.querySelector("ytd-watch-flexy")) return;
    SECONDARY_FEED_SELECTORS.forEach((sel) => {
      root
        .querySelectorAll(sel)
        .forEach((el) => el.classList.add(HIDE_SIDEBAR_CLASS));
    });
  }

  function removeGuideSidebar(root) {
    if (!settings.hideGuide) return;
    GUIDE_SELECTORS.forEach((sel) => {
      root
        .querySelectorAll(sel)
        .forEach((el) => el.classList.add(HIDE_GUIDE_CLASS));
    });
  }

  // YouTube's SPA can leave previously-visited pages' <ytd-browse> nodes
  // sitting in the DOM (marked [hidden]) instead of destroying them, so
  // "does a page-subtype=home element exist anywhere in the document"
  // is not a safe test — it can still say yes after you've navigated
  // away to, say, Playlists. Require the URL to actually be the home
  // page too, and only accept a match that isn't hidden.
  function getVisibleHomeBrowse() {
    if (location.pathname !== "/") return null;
    const candidates = document.querySelectorAll(
      'ytd-browse[page-subtype="home"]'
    );
    for (const el of candidates) {
      if (!el.hidden) return el;
    }
    return null;
  }

  function isHomePage() {
    return !!getVisibleHomeBrowse();
  }

  function isInProgress(el) {
    return !!el.querySelector(RESUME_OVERLAY_SELECTOR);
  }

  function filterHomeFeed() {
    if (!settings.homeFeedFilter) return;
    const browse = getVisibleHomeBrowse();
    if (!browse) return;

    HOME_ITEM_SELECTORS.forEach((sel) => {
      browse.querySelectorAll(sel).forEach((card) => {
        if (!isInProgress(card)) card.classList.add(HIDE_HOMEFEED_CLASS);
      });
    });

    HOME_SHELF_SELECTORS.forEach((sel) => {
      browse.querySelectorAll(sel).forEach((shelf) => {
        const title = (shelf.textContent || "").trim();
        const isContinueWatching = /continue watching/i.test(title);
        if (!isContinueWatching && !isInProgress(shelf)) {
          shelf.classList.add(HIDE_HOMEFEED_CLASS);
        }
      });
    });
  }

  const FOCUS_BANNER_ID = "ns-focus-banner";
  const HIDE_PRIMARY_CLASS = "ns-hide-primary";

  function removeFocusBanner() {
    const el = document.getElementById(FOCUS_BANNER_ID);
    if (el) el.remove();
    unhideAll(HIDE_PRIMARY_CLASS);
  }

  function findHomePrimaryColumn() {
    const browse = getVisibleHomeBrowse();
    if (!browse) return null;

    const byId =
      browse.querySelector("ytd-two-column-browse-results-renderer > #primary") ||
      browse.querySelector("#primary");
    if (byId) return byId;

    // Fallback: YouTube's markup for this has shifted before (the
    // Shorts shelf saga taught that lesson the hard way) — if #primary
    // doesn't exist, use the actual video grid's own parent instead of
    // giving up. Whatever wraps the grid IS functionally "the primary
    // column" regardless of what id it does or doesn't have.
    const grid = browse.querySelector("ytd-rich-grid-renderer");
    if (grid && grid.parentElement) return grid.parentElement;

    return null;
  }

  function ensureFocusBanner() {
    if (!settings.homeFeedFilter || !isHomePage()) {
      removeFocusBanner();
      return;
    }

    const primary = findHomePrimaryColumn();
    if (primary) primary.classList.add(HIDE_PRIMARY_CLASS);

    if (document.getElementById(FOCUS_BANNER_ID)) return;

    const banner = document.createElement("div");
    banner.id = FOCUS_BANNER_ID;

    const ringEl = document.createElement("div");
    ringEl.className = "ns-focus-banner-ring";

    const titleEl = document.createElement("div");
    titleEl.className = "ns-focus-banner-title";
    titleEl.textContent = "No Distraction is ON";

    const subEl = document.createElement("div");
    subEl.className = "ns-focus-banner-sub";
    subEl.textContent = "by Wasted";

    banner.appendChild(ringEl);
    banner.appendChild(titleEl);
    banner.appendChild(subEl);

    if (primary && primary.parentElement) {
      // Insert as a sibling right after the primary column, not inside
      // it (it's display:none, and a hidden ancestor would hide the
      // banner too) and not fixed to the full viewport — that would sit
      // on top of YouTube's own sidebar and masthead and block the
      // hamburger menu, search bar, etc. This fills only the content
      // column, at full width/height, leaving the rest of the UI
      // reachable.
      primary.parentElement.insertBefore(banner, primary.nextSibling);
      return;
    }

    // Last-resort fallback: couldn't locate (and therefore couldn't
    // hide) the primary column precisely. Show the banner anyway rather
    // than leaving a blank page with no explanation — worst case it
    // appears alongside some leftover content instead of replacing it
    // cleanly.
    const browse = getVisibleHomeBrowse();
    if (browse) browse.appendChild(banner);
  }

  /* ---------------- YouTube in-player ad handling (adBlock setting) ---------------- */
  /* Banner/companion/in-feed ad units are hidden purely via CSS in
     hide-shorts.css (gated on the data-ns-adblock attribute, which
     adblock.js already sets on every site including YouTube). This
     part only handles the video player itself: clicking "Skip Ad" the
     moment it's clickable, and muting + fast-forwarding through
     non-skippable ads. */

  const SKIP_BUTTON_SELECTORS = [
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button",
    ".ytp-skip-ad-button",
  ];

  const AD_OVERLAY_CLOSE_SELECTORS = [
    ".ytp-ad-overlay-close-button",
    ".ytp-ad-overlay-close-icon",
  ];

  function autoHandlePlayerAds(root) {
    if (!settings.adBlock) return;

    SKIP_BUTTON_SELECTORS.forEach((sel) => {
      root.querySelectorAll(sel).forEach((btn) => {
        if (btn instanceof HTMLElement) btn.click();
      });
    });

    AD_OVERLAY_CLOSE_SELECTORS.forEach((sel) => {
      root.querySelectorAll(sel).forEach((btn) => {
        if (btn instanceof HTMLElement) btn.click();
      });
    });

    root
      .querySelectorAll(
        ".html5-video-player.ad-showing, .html5-video-player.ad-interrupting"
      )
      .forEach((player) => {
        const video = player.querySelector("video");
        if (!video || !isFinite(video.duration) || video.duration <= 0) {
          return;
        }
        video.muted = true;
        if (video.currentTime < video.duration - 0.25) {
          video.currentTime = video.duration;
        }
      });
  }

  let adPollTimer = null;

  function startAdPolling() {
    if (adPollTimer) return;
    adPollTimer = window.setInterval(() => {
      autoHandlePlayerAds(document);
    }, 600);
  }

  function stopAdPolling() {
    if (!adPollTimer) return;
    window.clearInterval(adPollTimer);
    adPollTimer = null;
  }

  /* ---------------- Block Shorts (blockShorts setting) ---------------- */
  /* Written from scratch. Hides Shorts shelves, cards, the guide entry and
     the channel tab, and redirects /shorts/ID to the normal player. Only
     walks up to KNOWN container tags (never arbitrary ancestors), so the
     masthead, guide and player can't be caught by accident. */

  const HIDE_SHORTS_CLASS = "ns-hide-shorts";

  const SHORTS_SHELF_SELECTORS = [
    "ytd-reel-shelf-renderer",
    "ytd-rich-shelf-renderer[is-shorts]",
    "ytd-rich-section-renderer:has(ytd-reel-shelf-renderer)",
  ].join(",");

  const SHORTS_CARD_SELECTORS = [
    "ytd-reel-item-renderer",
    "ytm-shorts-lockup-view-model",
    "ytm-shorts-lockup-view-model-v2",
  ].join(",");

  const SHORTS_NAV_SELECTORS = [
    'ytd-guide-entry-renderer:has(a[title="Shorts"])',
    'ytd-mini-guide-entry-renderer[aria-label="Shorts"]',
    'yt-tab-shape[tab-title="Shorts"]',
    'yt-chip-cloud-chip-renderer[chip-style] [title="Shorts"]',
  ].join(",");

  const SHORTS_CONTAINER_TAGS = [
    "ytd-shelf-renderer",
    "grid-shelf-view-model",
    "ytd-reel-shelf-renderer",
    "ytd-rich-section-renderer",
    "ytd-item-section-renderer",
  ].join(",");

  const SHORTS_CARD_CONTAINERS = [
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-rich-item-renderer",
    "ytd-compact-video-renderer",
    "yt-lockup-view-model",
    "ytm-shorts-lockup-view-model",
    "ytm-shorts-lockup-view-model-v2",
  ].join(",");

  function redirectIfShorts() {
    if (!settings.blockShorts) return;
    const m = location.pathname.match(/^\/shorts\/([\w-]+)/);
    if (m) location.replace("/watch?v=" + m[1]);
  }

  function markShorts(el) {
    if (!el || el.classList.contains(HIDE_SHORTS_CLASS)) return;
    // never hide chrome-level elements
    if (el.closest("ytd-masthead, tp-yt-app-drawer#guide, #movie_player")) {
      return;
    }
    el.classList.add(HIDE_SHORTS_CLASS);
  }

  function removeShorts(root) {
    if (!settings.blockShorts) {
      // Off means off: always clear anything we hid earlier.
      if (document.querySelector("." + HIDE_SHORTS_CLASS)) {
        unhideAll(HIDE_SHORTS_CLASS);
      }
      return;
    }

    root.querySelectorAll(SHORTS_SHELF_SELECTORS).forEach(markShorts);
    root.querySelectorAll(SHORTS_CARD_SELECTORS).forEach(markShorts);
    root.querySelectorAll(SHORTS_NAV_SELECTORS).forEach(markShorts);

    // Cards that link to /shorts/ (home, subscriptions, sidebar).
    root.querySelectorAll('a[href^="/shorts/"]').forEach((a) => {
      markShorts(a.closest(SHORTS_CARD_CONTAINERS));
    });

    // Search/browse shelves: identify by the red Shorts icon or heading.
    const scope = root.querySelectorAll("ytd-search, ytd-browse:not([hidden])");
    scope.forEach((page) => {
      page.querySelectorAll('path[fill="#f03"]').forEach((p) => {
        markShorts(p.closest(SHORTS_CONTAINER_TAGS));
      });
      page
        .querySelectorAll('span[role="text"].ytAttributedStringHost')
        .forEach((span) => {
          if (/^\s*shorts\s*$/i.test(span.textContent || "")) {
            markShorts(span.closest(SHORTS_CONTAINER_TAGS));
          }
        });
    });
  }

  document.addEventListener("yt-navigate-start", redirectIfShorts, true);

  function cleanup(root) {
    removeShorts(root);
    removeSecondaryFeed(root);
    removeGuideSidebar(root);
    filterHomeFeed();
    ensureFocusBanner();
  }

  function runCleanup() {
    cleanup(document);
  }

  let cleanupScheduled = false;

  function scheduleCleanup() {
    if (cleanupScheduled) return;
    cleanupScheduled = true;
    window.requestAnimationFrame(() => {
      cleanupScheduled = false;
      runCleanup();
    });
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes && mutation.addedNodes.length > 0) {
        scheduleCleanup();
        break;
      }
    }
  });

  function startObserving() {
    runCleanup();
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    if (settings.adBlock) startAdPolling();
  }

  /* ---------------- 3. React live to settings changes from the popup ---------------- */

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.nsSettings) return;

    const oldSettings = settings;
    settings = effective(changes.nsSettings.newValue);
    applyAttributes();

    if (oldSettings.hideSidebar && !settings.hideSidebar) {
      unhideAll(HIDE_SIDEBAR_CLASS);
    }
    if (oldSettings.hideGuide && !settings.hideGuide) {
      unhideAll(HIDE_GUIDE_CLASS);
    }
    if (oldSettings.blockShorts && !settings.blockShorts) {
      unhideAll(HIDE_SHORTS_CLASS);
    }
    redirectIfShorts();
    if (oldSettings.homeFeedFilter && !settings.homeFeedFilter) {
      unhideAll(HIDE_HOMEFEED_CLASS);
    }
    if (settings.adBlock) {
      startAdPolling();
    } else {
      stopAdPolling();
    }

    runCleanup();
  });

  /* ---------------- 4. Boot ---------------- */

  loadSettings().then((loaded) => {
    settings = loaded;
    applyAttributes();
    redirectIfShorts();

    if (document.documentElement) {
      startObserving();
    } else {
      document.addEventListener("DOMContentLoaded", startObserving, {
        once: true,
      });
    }
  });
})();
