// ============================================================
//  Nexora PWA Install Manager v3.0
//  FIX: Banners render above #phone using fixed position on body
//  FIX: Works even when beforeinstallprompt hasn't fired yet
//  Handles: Android/Chrome, iOS Safari, Desktop Chrome/Edge
// ============================================================
(function () {
  'use strict';

  const DISMISSED_KEY   = 'nexora_pwa_dismissed';
  const INSTALLED_KEY   = 'nexora_pwa_installed';
  const REMIND_DELAY_MS = 3 * 24 * 60 * 60 * 1000;
  const SHOW_DELAY_MS   = 3500;

  // ── Platform detection ────────────────────────────────────
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua);
  const isIOSSafari = isIOS && isSafari;
  const isInStandaloneMode =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  if (isInStandaloneMode) {
    localStorage.setItem(INSTALLED_KEY, '1');
    return;
  }

  // ── Inject banners into <body> (NOT inside #phone) ────────
  function injectBanners() {
    document.body.insertAdjacentHTML('beforeend', `
      <!-- Android / Desktop install banner -->
      <div id="pwa-install-banner" role="dialog" aria-label="Install Nexora app">
        <div class="pwa-banner-inner">
          <div class="pwa-banner-top">
            <div class="pwa-banner-icon">✨</div>
            <div class="pwa-banner-text">
              <div class="pwa-banner-title">Install Nexora</div>
              <div class="pwa-banner-subtitle">Add to your home screen for the best experience</div>
            </div>
            <button class="pwa-banner-close" id="pwa-close-btn" aria-label="Dismiss">✕</button>
          </div>
          <div class="pwa-banner-features">
            <span class="pwa-feat"><span class="pwa-feat-icon">⚡</span>Works offline</span>
            <span class="pwa-feat"><span class="pwa-feat-icon">🔔</span>Notifications</span>
            <span class="pwa-feat"><span class="pwa-feat-icon">🚀</span>Faster</span>
            <span class="pwa-feat"><span class="pwa-feat-icon">📱</span>App feel</span>
          </div>
          <div class="pwa-banner-actions">
            <button class="pwa-btn-later" id="pwa-later-btn">Later</button>
            <button class="pwa-btn-install" id="pwa-install-btn"><span>📲</span> Install App</button>
          </div>
        </div>
      </div>

      <!-- iOS Safari manual instructions -->
      <div id="pwa-ios-banner" role="dialog" aria-label="Install Nexora on iOS">
        <div class="pwa-ios-inner">
          <div class="pwa-ios-head">
            <div class="pwa-ios-title">✨ Install Nexora</div>
            <button class="pwa-ios-close" id="pwa-ios-close" aria-label="Dismiss">✕</button>
          </div>
          <div class="pwa-ios-steps">
            <div class="pwa-ios-step">
              <div class="pwa-ios-step-num">1</div>
              <div class="pwa-ios-step-text">Tap the <strong>Share</strong> button
                <span class="pwa-ios-step-icon">⬆️</span> at the bottom of Safari</div>
            </div>
            <div class="pwa-ios-step">
              <div class="pwa-ios-step-num">2</div>
              <div class="pwa-ios-step-text">Scroll and tap <strong>"Add to Home Screen"</strong>
                <span class="pwa-ios-step-icon">➕</span></div>
            </div>
            <div class="pwa-ios-step">
              <div class="pwa-ios-step-num">3</div>
              <div class="pwa-ios-step-text">Tap <strong>"Add"</strong> — Nexora opens like a native app!
                <span class="pwa-ios-step-icon">🎉</span></div>
            </div>
          </div>
        </div>
      </div>

      <!-- SW update toast -->
      <div id="pwa-update-toast">
        <div class="pwa-update-inner">
          <div class="pwa-update-icon">🔄</div>
          <div class="pwa-update-text">
            <div class="pwa-update-title">Update available</div>
            <div class="pwa-update-sub">A new version of Nexora is ready</div>
          </div>
          <button class="pwa-update-btn" id="pwa-update-btn">Update now</button>
          <button class="pwa-update-dismiss" id="pwa-update-dismiss" aria-label="Dismiss">✕</button>
        </div>
      </div>

      <!-- Installed success toast -->
      <div id="pwa-installed-toast">
        <div class="pwa-installed-inner"><span>🎉</span> Nexora installed! Open from your home screen.</div>
      </div>
    `);
  }

  // ── Show / hide helpers ───────────────────────────────────
  function showEl(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.removeProperty('display');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.classList.add('visible');
    }));
  }

  function hideEl(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('visible');
    setTimeout(() => {
      if (!el.classList.contains('visible')) el.style.display = 'none';
    }, 500);
  }

  function showToastThenHide(id, duration = 4500) {
    showEl(id);
    setTimeout(() => hideEl(id), duration);
  }

  // ── Dismissal ─────────────────────────────────────────────
  function isDismissed() {
    const t = localStorage.getItem(DISMISSED_KEY);
    if (!t) return false;
    return (Date.now() - parseInt(t, 10)) < REMIND_DELAY_MS;
  }

  function dismiss(bannerId) {
    hideEl(bannerId);
    localStorage.setItem(DISMISSED_KEY, Date.now().toString());
  }

  // ── Boot ──────────────────────────────────────────────────
  let deferredPrompt = null;

  injectBanners();

  // Chrome/Edge/Android — native install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('[PWA] beforeinstallprompt captured');
    if (localStorage.getItem(INSTALLED_KEY)) return;
    if (isDismissed()) return;
    setTimeout(() => showEl('pwa-install-banner'), SHOW_DELAY_MS);
  });

  // Installed via browser chrome
  window.addEventListener('appinstalled', () => {
    localStorage.setItem(INSTALLED_KEY, '1');
    hideEl('pwa-install-banner');
    showToastThenHide('pwa-installed-toast', 5000);
  });

  // ── Button clicks (event delegation) ─────────────────────
  document.addEventListener('click', async (e) => {
    const id = e.target.id;

    if (id === 'pwa-close-btn' || id === 'pwa-later-btn') {
      dismiss('pwa-install-banner');
    }

    if (id === 'pwa-install-btn') {
      hideEl('pwa-install-banner');
      if (deferredPrompt) {
        try {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          deferredPrompt = null;
          if (outcome === 'accepted') {
            localStorage.setItem(INSTALLED_KEY, '1');
            showToastThenHide('pwa-installed-toast', 5000);
          } else {
            localStorage.setItem(DISMISSED_KEY, Date.now().toString());
          }
        } catch (err) {
          console.warn('[PWA] Install prompt error:', err);
        }
      }
    }

    if (id === 'pwa-ios-close') dismiss('pwa-ios-banner');

    if (id === 'pwa-update-btn') {
      hideEl('pwa-update-toast');
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
        if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      setTimeout(() => window.location.reload(), 300);
    }

    if (id === 'pwa-update-dismiss') hideEl('pwa-update-toast');
  });

  // ── iOS Safari — show manual steps ───────────────────────
  if (isIOSSafari && !localStorage.getItem(INSTALLED_KEY) && !isDismissed()) {
    setTimeout(() => showEl('pwa-ios-banner'), SHOW_DELAY_MS);
  }

  // ── SW update detection ───────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then((reg) => {
      if (reg.waiting) setTimeout(() => showEl('pwa-update-toast'), 1500);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            setTimeout(() => showEl('pwa-update-toast'), 1500);
          }
        });
      });
    }).catch(() => {});

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) { refreshing = true; window.location.reload(); }
    });
  }

  // ── DEBUG helper — type in console to test banners ────────
  // __pwaTest('install') | __pwaTest('ios') | __pwaTest('update')
  window.__pwaTest = (which) => {
    const map = {
      install:   'pwa-install-banner',
      ios:       'pwa-ios-banner',
      update:    'pwa-update-toast',
      installed: 'pwa-installed-toast'
    };
    const el = document.getElementById(map[which]);
    if (el) { el.style.removeProperty('display'); el.classList.add('visible'); }
    else console.log('Options: install | ios | update | installed');
  };

})();
