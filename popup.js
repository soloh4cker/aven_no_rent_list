(() => {
  'use strict';

  const STORAGE_KEY = 'noRentGuests';
  const $ = id => document.getElementById(id);
  const elements = {
    form: $('guestForm'),
    editId: $('editId'),
    first: $('firstName'),
    last: $('lastName'),
    reason: $('reason'),
    confirmation: $('confirmationNumber'),
    save: $('saveButton'),
    cancel: $('cancelEdit'),
    title: $('formTitle'),
    search: $('search'),
    list: $('list'),
    count: $('count'),
    empty: $('empty'),
    exportButton: $('exportButton'),
    importButton: $('importButton'),
    importFile: $('importFile'),
    status: $('status'),
    pageDomain: $('pageDomain'),
    detectedGuest: $('detectedGuest'),
    matchResult: $('matchResult'),
    checkPage: $('checkPage'),
    diagnosticHelp: $('diagnosticHelp')
  };

  let guests = [];

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const normalize = value => clean(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();
  const makeId = () => crypto.randomUUID
    ? crypto.randomUUID()
    : `g-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  function showMessage(text, type = '') {
    elements.status.textContent = text;
    elements.status.className = `status ${type}`.trim();
    clearTimeout(showMessage.timer);
    showMessage.timer = setTimeout(() => {
      elements.status.textContent = '';
      elements.status.className = 'status';
    }, 3500);
  }

  function sortGuests() {
    guests.sort((a, b) =>
      clean(a.lastName).localeCompare(clean(b.lastName), undefined, { sensitivity: 'base' }) ||
      clean(a.firstName).localeCompare(clean(b.firstName), undefined, { sensitivity: 'base' })
    );
  }

  async function persist(successText) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: guests });
      render();
      if (successText) showMessage(successText, 'success');
      await checkCurrentPage(false);
    } catch (error) {
      console.error(error);
      showMessage('Could not save the list.', 'error');
    }
  }

  function resetForm() {
    elements.form.reset();
    elements.editId.value = '';
    elements.title.textContent = 'Add guest';
    elements.save.textContent = 'Add to no-rent list';
    elements.cancel.classList.add('hidden');
  }

  function beginEdit(guest) {
    elements.editId.value = guest.id;
    elements.first.value = clean(guest.firstName);
    elements.last.value = clean(guest.lastName);
    elements.reason.value = clean(guest.reason);
    elements.confirmation.value = clean(guest.confirmationNumber);
    elements.title.textContent = 'Edit guest';
    elements.save.textContent = 'Save changes';
    elements.cancel.classList.remove('hidden');
    document.documentElement.scrollTop = 0;
  }

  function createButton(text, className, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.className = className;
    button.addEventListener('click', handler);
    return button;
  }

  function render() {
    const query = normalize(elements.search.value);
    const filtered = guests.filter(guest =>
      !query || [
        guest.firstName,
        guest.lastName,
        guest.reason,
        guest.confirmationNumber
      ].some(value => normalize(value).includes(query))
    );

    elements.list.replaceChildren();
    elements.count.textContent = String(guests.length);
    elements.empty.classList.toggle('hidden', filtered.length > 0);
    elements.empty.textContent = guests.length && filtered.length === 0
      ? 'No saved guest matches your search.'
      : 'No guests have been added yet.';

    for (const guest of filtered) {
      const card = document.createElement('article');
      card.className = 'card';

      const header = document.createElement('div');
      header.className = 'card-head';

      const name = document.createElement('p');
      name.className = 'name';
      name.textContent = `${clean(guest.lastName)}, ${clean(guest.firstName)}`;

      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.append(
        createButton('Edit', 'small', () => beginEdit(guest)),
        createButton('Delete', 'small delete', async () => {
          if (!confirm(`Remove ${guest.firstName} ${guest.lastName} from the no-rent list?`)) return;
          guests = guests.filter(item => item.id !== guest.id);
          if (elements.editId.value === guest.id) resetForm();
          await persist('Guest removed.');
        })
      );

      header.append(name, actions);

      const details = document.createElement('p');
      details.className = 'details';
      details.textContent =
        `Reason: ${clean(guest.reason) || 'Not provided'}\n` +
        `Confirmation #: ${clean(guest.confirmationNumber) || 'Not provided'}`;
      details.style.whiteSpace = 'pre-line';

      card.append(header, details);
      elements.list.append(card);
    }
  }

  async function sendDiagnostic(tabId) {
    try {
      return await chrome.tabs.sendMessage(
        tabId,
        { type: 'aven-diagnostic' },
        { frameId: 0 }
      );
    } catch {
      return null;
    }
  }

  async function injectDetector(tabId) {
    try {
      await chrome.scripting.insertCSS({
        target: { tabId, allFrames: true },
        files: ['content.css']
      });
    } catch {
      // CSS may already be present or a particular frame may not allow injection.
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content.js']
      });
      return true;
    } catch (error) {
      console.error('Detector injection failed:', error);
      return false;
    }
  }

  async function checkCurrentPage(showCheckingText = true) {
    if (showCheckingText) {
      elements.pageDomain.textContent = 'Checking the current tab...';
      elements.detectedGuest.textContent = '';
      elements.matchResult.textContent = '';
      elements.diagnosticHelp.textContent = '';
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active Chrome tab was found.');

      let host = 'Unknown page';
      try {
        host = new URL(tab.url).host || tab.url;
      } catch {
        host = tab.url || 'Unknown page';
      }
      elements.pageDomain.textContent = `Current page: ${host}`;

      let result = await sendDiagnostic(tab.id);
      if (!result?.loaded) {
        const injected = await injectDetector(tab.id);
        if (injected) {
          await new Promise(resolve => setTimeout(resolve, 600));
          result = await sendDiagnostic(tab.id);
        }
      }

      if (!result?.loaded) {
        elements.detectedGuest.textContent = 'Detector status: Not running on this tab';
        elements.matchResult.textContent = '';
        elements.diagnosticHelp.textContent =
          'Reload the Aven tab, then check again. If it still fails, the Aven website domain is not in the extension permission list.';
        return;
      }

      elements.detectedGuest.textContent = result.guestName
        ? `Detected Aven guest: ${result.guestName}`
        : 'Detector is running, but no guest-name element is currently visible.';

      if (!result.guestName) {
        elements.matchResult.textContent = `Saved no-rent records in this Windows/Chrome profile: ${result.savedGuestCount}`;
        elements.diagnosticHelp.textContent =
          'Open a reservation so the guest profile is visible, then click “Check current page again.”';
      } else if (result.matchCount > 0) {
        elements.matchResult.textContent = `Match result: ${result.matchCount} no-rent match${result.matchCount === 1 ? '' : 'es'} found`;
        elements.diagnosticHelp.textContent =
          'A red warning should be visible on the Aven page. Close this extension popup to view it.';
      } else {
        elements.matchResult.textContent = 'Match result: No saved record matched this detected name';
        elements.diagnosticHelp.textContent =
          'Check the saved first and last names below. Name order and capitalization do not matter.';
      }
    } catch (error) {
      console.error(error);
      elements.pageDomain.textContent = 'Could not test the current page.';
      elements.detectedGuest.textContent = '';
      elements.matchResult.textContent = '';
      elements.diagnosticHelp.textContent = error.message || 'Unknown diagnostic error.';
    }
  }

  elements.form.addEventListener('submit', async event => {
    event.preventDefault();

    const firstName = clean(elements.first.value);
    const lastName = clean(elements.last.value);
    const reason = clean(elements.reason.value);
    const confirmationNumber = clean(elements.confirmation.value);
    const id = elements.editId.value;

    if (!firstName || !lastName) {
      showMessage('First and last name are required.', 'error');
      return;
    }

    const now = new Date().toISOString();

    if (id) {
      const index = guests.findIndex(guest => guest.id === id);
      if (index < 0) {
        showMessage('Entry not found.', 'error');
        return;
      }
      guests[index] = {
        ...guests[index],
        firstName,
        lastName,
        reason,
        confirmationNumber,
        updatedAt: now
      };
      sortGuests();
      await persist('Changes saved.');
    } else {
      const duplicate = guests.some(guest =>
        normalize(guest.firstName) === normalize(firstName) &&
        normalize(guest.lastName) === normalize(lastName)
      );
      if (duplicate && !confirm('A guest with the same name already exists. Add another entry anyway?')) {
        return;
      }
      guests.push({
        id: makeId(),
        firstName,
        lastName,
        reason,
        confirmationNumber,
        createdAt: now,
        updatedAt: now
      });
      sortGuests();
      await persist('Guest added.');
    }

    resetForm();
  });

  elements.cancel.addEventListener('click', resetForm);
  elements.search.addEventListener('input', render);
  elements.checkPage.addEventListener('click', () => checkCurrentPage(true));

  elements.exportButton.addEventListener('click', () => {
    const blob = new Blob([
      JSON.stringify({
        format: 'aven-no-rent-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        guests
      }, null, 2)
    ], { type: 'application/json' });

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `aven-no-rent-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  elements.importButton.addEventListener('click', () => {
    elements.importFile.value = '';
    elements.importFile.click();
  });

  elements.importFile.addEventListener('change', async () => {
    try {
      const file = elements.importFile.files?.[0];
      if (!file) return;

      const parsed = JSON.parse(await file.text());
      const imported = Array.isArray(parsed) ? parsed : parsed.guests;
      if (!Array.isArray(imported)) throw new Error('No guest list found.');

      const cleaned = imported.map(guest => ({
        id: clean(guest.id) || makeId(),
        firstName: clean(guest.firstName),
        lastName: clean(guest.lastName),
        reason: clean(guest.reason),
        confirmationNumber: clean(guest.confirmationNumber),
        createdAt: clean(guest.createdAt) || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })).filter(guest => guest.firstName && guest.lastName);

      if (!confirm(`Import ${cleaned.length} guest(s)? This replaces the current list.`)) return;
      guests = cleaned;
      sortGuests();
      await persist('Backup imported.');
      resetForm();
    } catch (error) {
      showMessage(error.message || 'Import failed.', 'error');
    }
  });

  chrome.storage.local.get(STORAGE_KEY).then(result => {
    guests = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
    sortGuests();
    render();
    checkCurrentPage(true);
  }).catch(() => showMessage('Could not load saved list.', 'error'));
})();
