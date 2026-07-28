(() => {
  'use strict';

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (!message || message.type !== 'aven-frame-guest-update' || !sender.tab?.id) {
      return;
    }

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
      // The top-frame content script may not be ready yet. Subframes resend status periodically.
    });
  });
})();
