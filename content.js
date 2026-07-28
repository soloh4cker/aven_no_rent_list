(() => {
  'use strict';

  if (globalThis.__avenNoRentAlertLoaded) return;
  globalThis.__avenNoRentAlertLoaded = true;

  const STORAGE_KEY = 'noRentGuests';
  const ALERT_ROOT_ID = 'aven-no-rent-alert-root';
  const IS_TOP_FRAME = window.top === window;
  const SELECTORS = [
    '#gsr-profile h4.primary-guest-info__label-ellipsis',
    '#gsr-profile > div > div > section > div > h4',
    'h4.primary-guest-info__label-ellipsis',
    '.primary-guest-info__label-ellipsis'
  ];
  const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'sir', 'madam']);

  let noRentGuests = [];
  let lastLocalGuestName = null;
  let lastReportTime = 0;
  let scanTimer = 0;

  const frameGuests = new Map();
  let currentGuestKey = '';
  let dismissedSignature = '';

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

  const normalize = value => clean(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  function tokenize(value, removeTitles = false) {
    const parts = normalize(value).split(' ').filter(Boolean);
    return removeTitles ? parts.filter(token => !TITLES.has(token)) : parts;
  }

  function containsAllTokens(availableTokens, requiredTokens) {
    const counts = new Map();
    for (const token of availableTokens) {
      counts.set(token, (counts.get(token) || 0) + 1);
    }
    for (const token of requiredTokens) {
      const count = counts.get(token) || 0;
      if (count < 1) return false;
      counts.set(token, count - 1);
    }
    return true;
  }

  function matchesEntry(guestName, entry) {
    const first = tokenize(entry.firstName);
    const last = tokenize(entry.lastName);
    if (!first.length || !last.length) return false;
    return containsAllTokens(tokenize(guestName, true), [...first, ...last]);
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findDisplayedGuestName() {
    const found = [];
    const seen = new Set();

    for (const selector of SELECTORS) {
      for (const element of document.querySelectorAll(selector)) {
        if (seen.has(element)) continue;
        seen.add(element);
        found.push(element);
      }
    }

    const visible = found.filter(isVisible);
    for (const element of visible.length ? visible : found) {
      const text = clean(element.textContent);
      if (text) return text;
    }
    return '';
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function removeAlert() {
    document.getElementById(ALERT_ROOT_ID)?.remove();
  }

  function makeSignature(guestName, matches) {
    const matchParts = matches.map(entry => [
      clean(entry.id),
      normalize(entry.firstName),
      normalize(entry.lastName),
      normalize(entry.reason),
      normalize(entry.confirmationNumber)
    ].join(':')).sort();
    return `${normalize(guestName)}::${matchParts.join('|')}`;
  }

  function addDetailRow(parent, label, value) {
    const row = createElement('div', 'nr-row');
    row.append(
      createElement('div', 'nr-label', label),
      createElement('div', 'nr-value', clean(value) || 'Not provided')
    );
    parent.append(row);
  }

  async function copyText(value, button) {
    const text = clean(value);
    if (!text) return;
    const original = button.textContent;

    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        button.textContent = 'Copied';
      } catch {
        button.textContent = 'Copy failed';
      }
      textarea.remove();
    }

    setTimeout(() => {
      if (button.isConnected) button.textContent = original;
    }, 1400);
  }

  function showAlert(guestName, matches, signature) {
    removeAlert();

    const root = createElement('div');
    root.id = ALERT_ROOT_ID;
    root.dataset.signature = signature;
    root.setAttribute('role', 'alertdialog');
    root.setAttribute('aria-label', 'No-rent list match');

    const card = createElement('section', 'nr-card');
    const header = createElement('header', 'nr-head');
    const icon = createElement('div', 'nr-icon', '!');
    const titleWrap = createElement('div', 'nr-titlewrap');
    titleWrap.append(
      createElement('h2', 'nr-title', 'NO-RENT LIST MATCH'),
      createElement(
        'p',
        'nr-sub',
        `${matches.length} matching restricted-guest record${matches.length === 1 ? '' : 's'} found`
      )
    );

    const closeButton = createElement('button', 'nr-close', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close no-rent warning');
    closeButton.addEventListener('click', () => {
      dismissedSignature = signature;
      removeAlert();
    });

    header.append(icon, titleWrap, closeButton);

    const body = createElement('div', 'nr-body');
    const currentGuest = createElement('p', 'nr-current');
    currentGuest.append(
      createElement('strong', '', 'Guest shown in Aven: '),
      document.createTextNode(guestName)
    );
    body.append(currentGuest);

    for (const entry of matches) {
      const matchCard = createElement('article', 'nr-match');
      matchCard.append(
        createElement('p', 'nr-name', `${clean(entry.lastName)}, ${clean(entry.firstName)}`)
      );
      addDetailRow(matchCard, 'Reason', entry.reason);
      addDetailRow(matchCard, 'Past confirmation #', entry.confirmationNumber);

      if (clean(entry.confirmationNumber)) {
        const copyButton = createElement('button', 'nr-copy', 'Copy confirmation #');
        copyButton.type = 'button';
        copyButton.addEventListener('click', () => copyText(entry.confirmationNumber, copyButton));
        matchCard.append(copyButton);
      }

      body.append(matchCard);
    }

    body.append(
      createElement('p', 'nr-footer', 'Please review the past reservation before proceeding.')
    );
    card.append(header, body);
    root.append(card);
    document.documentElement.append(root);
  }

  function removeExpiredFrameReports() {
    const cutoff = Date.now() - 10000;
    for (const [frameId, report] of frameGuests.entries()) {
      if (report.updatedAt < cutoff) frameGuests.delete(frameId);
    }
  }

  function getBestReportedGuest() {
    removeExpiredFrameReports();

    const topReport = frameGuests.get(0);
    if (topReport?.guestName) return topReport.guestName;

    let newest = null;
    for (const report of frameGuests.values()) {
      if (!report.guestName) continue;
      if (!newest || report.updatedAt > newest.updatedAt) newest = report;
    }
    return newest?.guestName || '';
  }

  function evaluateTopFrame() {
    if (!IS_TOP_FRAME) return;

    const guestName = getBestReportedGuest();
    const guestKey = normalize(guestName);

    if (guestKey !== currentGuestKey) {
      currentGuestKey = guestKey;
      dismissedSignature = '';
      removeAlert();
    }

    if (!guestName) {
      removeAlert();
      return;
    }

    const matches = noRentGuests.filter(entry => matchesEntry(guestName, entry));
    if (!matches.length) {
      removeAlert();
      return;
    }

    const signature = makeSignature(guestName, matches);
    if (signature === dismissedSignature) return;

    const existing = document.getElementById(ALERT_ROOT_ID);
    if (!existing || existing.dataset.signature !== signature) {
      showAlert(guestName, matches, signature);
    }
  }

  function reportLocalGuest(force = false) {
    const guestName = findDisplayedGuestName();
    const now = Date.now();
    const changed = guestName !== lastLocalGuestName;

    if (!changed && !force && now - lastReportTime < 4000) return;

    lastLocalGuestName = guestName;
    lastReportTime = now;

    if (IS_TOP_FRAME) {
      frameGuests.set(0, {
        guestName,
        frameUrl: location.href,
        updatedAt: now
      });
      evaluateTopFrame();
    }

    chrome.runtime.sendMessage({
      type: 'aven-frame-guest-update',
      guestName
    }).catch(() => {});
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => reportLocalGuest(false), 180);
  }

  if (IS_TOP_FRAME) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'aven-forwarded-guest-update') {
        frameGuests.set(message.frameId, {
          guestName: clean(message.guestName),
          frameUrl: clean(message.frameUrl),
          updatedAt: Date.now()
        });
        evaluateTopFrame();
        return;
      }

      if (message?.type === 'aven-diagnostic') {
        const guestName = getBestReportedGuest();
        const matches = guestName
          ? noRentGuests.filter(entry => matchesEntry(guestName, entry))
          : [];

        sendResponse({
          loaded: true,
          guestName,
          matchCount: matches.length,
          savedGuestCount: noRentGuests.length,
          pageUrl: location.href,
          frameReports: [...frameGuests.values()].filter(report => report.guestName).length,
          selectors: SELECTORS
        });
      }
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
      noRentGuests = Array.isArray(changes[STORAGE_KEY].newValue)
        ? changes[STORAGE_KEY].newValue
        : [];
      dismissedSignature = '';
      evaluateTopFrame();
    });

    chrome.storage.local.get(STORAGE_KEY).then(result => {
      noRentGuests = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
      evaluateTopFrame();
    }).catch(error => console.error('Aven No-Rent Alert storage error:', error));
  }

  new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  reportLocalGuest(true);
  setInterval(() => reportLocalGuest(true), 3000);
})();
