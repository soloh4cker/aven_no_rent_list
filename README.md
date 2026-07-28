# Aven No-Rent Alert v1.2.0

A Chrome extension that watches Aven/SynXis for the displayed guest name and warns staff when it matches the hotel's locally managed no-rent list. It does not click, disable, or alter any Aven control.

## Guest-name detection

Version 1.2 checks several selectors, including:

```css
#gsr-profile h4.primary-guest-info__label-ellipsis
#gsr-profile > div > div > section > div > h4
h4.primary-guest-info__label-ellipsis
.primary-guest-info__label-ellipsis
```

The short class selector is valid CSS and is normally more stable than Chrome's long copied selector. Version 1.2 also detects names inside Aven frames and relays them to the top page so the warning is not trapped or hidden inside an iframe.

## Install or update

1. Download the `aven-no-rent-alert-v1` branch as a ZIP and extract it.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. For an existing installation, remove the old extension and use **Load unpacked** again, or replace the old extension folder and click **Reload** on its card.
5. Select the extracted `aven-no-rent-alert` folder containing `manifest.json`.
6. Confirm Chrome shows version **1.2.0**.
7. Fully reload the Aven tab with `Ctrl+R`.
8. Pin the extension from Chrome's Extensions menu.

Content scripts are not automatically inserted into a page that was already open before an extension was installed or reloaded. The Aven tab must be reloaded.

## Live page test

Open a reservation in Aven, then click the extension icon. The top panel reports:

- Current website domain
- Whether the detector is running
- The guest name detected from Aven
- Number of saved records in this Chrome profile
- Whether the detected name matches the no-rent list

The **Check current page again** button also attempts a temporary active-tab injection when the normal content script is not running.

## Add and match a guest

Click the extension icon and add:

- First name
- Last name
- Reason
- Past confirmation number

Matching is case-insensitive, punctuation-insensitive, and independent of name order. A saved `Andrew` + `Forbes` entry matches `Forbes, Andrew`, `Andrew, Forbes`, `Forbes Andrew`, and `ANDREW FORBES`.

Click the X to dismiss the warning for the currently displayed guest. Opening another guest resets the check. The confirmation number can be copied from the warning.

## Storage limitation

The list currently uses `chrome.storage.local`. It belongs to one Chrome profile inside one Windows user account.

Separate Windows logins on the same physical computer have separate Chrome data folders. Therefore they do **not** automatically share the same no-rent list or unpacked-extension installation. Export/Import can copy the list manually, but it does not keep profiles synchronized.

A production shared-list version should use either:

1. A small local Windows service with a database in `C:\ProgramData`, shared by every Windows login on that front-desk computer; or
2. A secured central database when multiple front-desk computers must share the list.

## Supported domains

The manifest currently runs automatically on:

- `https://*.synxis.com/*`
- `https://*.avenhospitality.com/*`

If the diagnostic panel shows another Aven domain, add that exact domain pattern to both `host_permissions` and `content_scripts.matches` in `manifest.json`.

## First test

1. Use a test reservation or an authorized record.
2. Add the exact first and last name to the extension.
3. Open that reservation in Aven.
4. Click the extension icon and read the live diagnostic result.
5. Close the extension popup to view the red warning on the Aven page.
6. Test the X and confirmation-number copy button.
7. Open another reservation and return to verify detection runs again.

Keep reasons factual and limited to information needed by authorized hotel staff. Protect exported backups because they may contain guest incident information.
