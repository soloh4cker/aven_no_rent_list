(() => {
  'use strict';

  const NATIVE_HOST = 'com.daysinn.aven_no_rent';
  const CACHE_MAX_AGE_MS = 5000;

  let cachedState = {
    ok: false,
    guests: [],
    canWrite: false,
    dataPath: '',
    managerAccount: '',
    hostVersion: '',
    lastUpdatedUtc: '',
    error: 'Shared storage has not been contacted yet.'
  };
  let cachedAt = 0;
  let pendingRead = null;

  function cleanState(response) {
    return {
      ok: response?.ok === true,
      guests: Array.isArray(response?.guests) ? response.guests : [],
      canWrite: response?.canWrite === true,
      dataPath: String(response?.dataPath || ''),
      managerAccount: String(response?.managerAccount || ''),
      hostVersion: String(response?.hostVersion || ''),
      lastUpdatedUtc: String(response?.lastUpdatedUtc || ''),
      error: String(response?.error || '')
    };
  }

  async function callNative(command, extra = {}) {
    try {
      const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST, {
        command,
        ...extra
      });

      if (!response || response.ok !== true) {
        throw new Error(response?.error || 'The shared-storage helper returned an invalid response.');
      }

      return cleanState(response);
    } catch (error) {
      return {
        ...cachedState,
        ok: false,
        error: error?.message || String(error) || 'Could not contact the shared-storage helper.'
      };
    }
  }

  async function getSharedState(forceRefresh = false) {
    const freshEnough = Date.now() - cachedAt < CACHE_MAX_AGE_MS;
    if (!forceRefresh && cachedState.ok && freshEnough) {
      return cachedState;
    }

    if (pendingRead) return pendingRead;

    pendingRead = callNative('getList').then(state => {
      if (state.ok) {
        cachedState = state;
        cachedAt = Date.now();
      } else {
        cachedState = { ...cachedState, ok: false, error: state.error };
      }
      return cachedState;
    }).finally(() => {
      pendingRead = null;
    });

    return pendingRead;
  }

  async function replaceSharedList(guests) {
    const state = await callNative('replaceList', {
      guests: Array.isArray(guests) ? guests : []
    });

    if (state.ok) {
      cachedState = state;
      cachedAt = Date.now();
      broadcastSharedState(state);
    }

    return state;
  }

  async function broadcastSharedState(state) {
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (!tab.id) continue;
        chrome.tabs.sendMessage(
          tab.id,
          { type: 'aven-shared-list-updated', state },
          { frameId: 0 }
        ).catch(() => {});
      }
    } catch {
      // Some tabs cannot receive extension messages. That is expected.
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return;

    if (message.type === 'aven-frame-guest-update' && sender.tab?.id) {
      chrome.tabs.sendMessage(
        sender.tab.id,
        {
          type: 'aven-forwarded-guest-update',
          frameId: Number.isInteger(sender.frameId) ? sender.frameId : -1,
          frameUrl: sender.url || '',
          guestName: String(message.guestName || '')
        },
        { frameId: 0 }
      ).catch(() => {
        // The top-frame script may not be ready yet. Frames report again periodically.
      });
      return;
    }

    if (message.type === 'aven-shared-get') {
      getSharedState(message.forceRefresh === true)
        .then(sendResponse)
        .catch(error => sendResponse({
          ...cachedState,
          ok: false,
          error: error?.message || String(error)
        }));
      return true;
    }

    if (message.type === 'aven-shared-replace') {
      replaceSharedList(message.guests)
        .then(sendResponse)
        .catch(error => sendResponse({
          ...cachedState,
          ok: false,
          error: error?.message || String(error)
        }));
      return true;
    }

    if (message.type === 'aven-shared-status') {
      callNative('status')
        .then(sendResponse)
        .catch(error => sendResponse({
          ...cachedState,
          ok: false,
          error: error?.message || String(error)
        }));
      return true;
    }
  });

  getSharedState(true).catch(() => {});
})();
