# Aven No-Rent Alert v2.0.0

A Chrome extension for Aven/SynXis that warns front desk staff when the displayed guest matches the hotel's no-rent list.

Version 2 keeps the working Version 1.2 detection and warning behavior, but moves the no-rent list into one shared Windows file so every Windows login on the same front-desk computer sees the same data.

## Version 2 design

- Shared data file: `C:\ProgramData\DaysInn\AvenNoRent\Data\no-rent-list.json`
- One physical Windows 11 computer
- No web server
- No cloud database
- No Windows service running continuously
- Chrome starts the small native helper only when it needs to read or save the shared list
- The Windows account that runs the installer becomes the only manager account
- Other Windows accounts receive warnings and have read-only access
- Export and Import remain available to the manager account
- No automatic backup system is added

## Install Version 2

Do these steps while signed into the Windows administrator account that should manage the no-rent list.

1. Download the `v2-shared-storage` branch as a ZIP.
2. Extract the complete ZIP to a normal folder.
3. Double-click `INSTALL_SHARED_STORAGE.bat`.
4. Approve the Windows administrator prompt.
5. Wait for the message **Installation completed successfully**.
6. The installer opens this folder:
   `C:\ProgramData\DaysInn\AvenNoRent`
7. Open Chrome and go to `chrome://extensions`.
8. Turn on **Developer mode**.
9. Remove the older Aven No-Rent Alert extension.
10. Click **Load unpacked**.
11. Select:
    `C:\ProgramData\DaysInn\AvenNoRent\Extension`
12. Confirm Chrome shows Version **2.0.0**.
13. Reload the Aven tab with `Ctrl+R`.

The first time the manager opens Version 2, the extension checks for a Version 1.2 list stored in that Chrome profile. When the shared list is empty, it offers to move the old local list into shared storage.

## Install for each front desk Windows login

The machine-wide helper and shared file are already installed. Under every other Windows login:

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode**.
4. Remove an older Aven No-Rent Alert extension, if present.
5. Click **Load unpacked**.
6. Select the exact same folder:
   `C:\ProgramData\DaysInn\AvenNoRent\Extension`
7. Reload the Aven tab.

Those accounts should display:

> Shared storage: Connected — read-only front desk access

They can view the list and receive warning popups, but Add, Edit, Delete, and Import are unavailable.

## Manager permissions

The installer records the exact Windows security identifier of the account that ran it. The native helper allows changes only when Chrome is running under that same Windows account.

Standard front desk accounts have read access to the application and shared JSON file. They do not have file-system write permission, and the helper separately rejects write commands from their Windows account.

To change which Windows account is the manager, sign into the new manager account and run `INSTALL_SHARED_STORAGE.bat` again as administrator.

## Shared storage files

After installation:

```text
C:\ProgramData\DaysInn\AvenNoRent\
├── Extension\
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   └── ...
├── NativeHost\
│   ├── AvenNoRentHost.exe
│   ├── config.json
│   └── com.daysinn.aven_no_rent.json
├── Data\
│   └── no-rent-list.json
├── extension-key.txt
└── INSTALL_INFO.txt
```

The installer adds a stable extension key to the installed copy. This gives the extension the same Chrome extension ID under every Windows login. The native messaging host is registered machine-wide in Windows.

## Guest matching

Version 2 retains the Version 1.2 selectors and iframe handling:

```css
#gsr-profile h4.primary-guest-info__label-ellipsis
#gsr-profile > div > div > section > div > h4
h4.primary-guest-info__label-ellipsis
.primary-guest-info__label-ellipsis
```

Matching is case-insensitive, punctuation-insensitive, and independent of name order. A saved `Andrew` + `Forbes` record matches:

- `Forbes, Andrew`
- `Andrew, Forbes`
- `Forbes Andrew`
- `ANDREW FORBES`

The warning does not click, disable, or alter Aven controls. Staff can close it with the X.

## Test checklist

### Manager Windows account

1. Open the extension.
2. Confirm it says **Shared storage: Connected — manager access**.
3. Add a test guest.
4. Open the matching reservation in Aven.
5. Confirm the red warning appears.
6. Export a backup and confirm the file downloads.

### Front desk Windows account

1. Install the extension from the shared ProgramData Extension folder.
2. Confirm it says **read-only front desk access**.
3. Confirm the same test guest appears in the saved list.
4. Confirm no Add, Edit, Delete, or Import controls appear.
5. Open the matching Aven reservation and confirm the warning appears.

## Troubleshooting

### Shared storage says Not connected

1. Confirm `INSTALL_SHARED_STORAGE.bat` completed successfully.
2. Confirm Chrome loaded the extension from:
   `C:\ProgramData\DaysInn\AvenNoRent\Extension`
3. Open `chrome://extensions` and confirm Version 2.0.0.
4. Click the extension's Reload button.
5. Reload the Aven tab.
6. Run the installer again if the native-host registration is missing.

### Manager account appears read-only

Run `INSTALL_SHARED_STORAGE.bat` while signed into the Windows account that should manage the list. The installer assigns manager access to the exact account that runs it.

### Remove Version 2

Run `installer\Uninstall.ps1` as administrator. It removes the native-host registration and installed application files but preserves the shared data file and extension key.

Keep incident reasons factual and limited to information needed by authorized hotel staff. Protect exported backup files because they contain guest incident information.
