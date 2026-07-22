'use strict';

/* =============================================
   AttendPro — Google Drive Sync Module
   ============================================= */

const Drive = (() => {
  let _accessToken  = null;
  let _tokenExpiry  = 0;
  let _folderId     = null;   // "AttendPro" folder in Drive
  let _attFolderId  = null;   // "AttendPro/attendance" folder
  let _syncing      = false;
  let _clientId     = null;
  let _tokenClient  = null;   // GIS token client reference

  /* =============================================
     INIT
     ============================================= */

  async function init() {
    _clientId    = await DB.settings.get('drive_client_id') || null;
    _accessToken = localStorage.getItem('drive_access_token');
    _tokenExpiry = parseInt(localStorage.getItem('drive_token_expiry') || '0');
    _folderId    = localStorage.getItem('drive_folder_id')   || null;
    _attFolderId = localStorage.getItem('drive_att_folder_id') || null;

    // Clear expired token
    if (_accessToken && Date.now() > _tokenExpiry) _clearToken();

    _updateTopbarIcon();
  }

  function isConnected() {
    return !!_accessToken && Date.now() < _tokenExpiry;
  }

  function _clearToken() {
    _accessToken = null;
    _tokenExpiry = 0;
    _folderId    = null;
    _attFolderId = null;
    localStorage.removeItem('drive_access_token');
    localStorage.removeItem('drive_token_expiry');
    localStorage.removeItem('drive_folder_id');
    localStorage.removeItem('drive_att_folder_id');
  }

  /* =============================================
     CONNECT / DISCONNECT
     ============================================= */

  async function connect() {
    if (!_clientId) {
      App.toast('Enter your Google Client ID first', 'error');
      return;
    }
    if (typeof google === 'undefined' || !google?.accounts?.oauth2) {
      App.toast('Google library not loaded — check your internet connection and try again', 'error');
      return;
    }

    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: _clientId,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: async (response) => {
        if (response.error) {
          App.toast('Auth failed: ' + (response.error_description || response.error), 'error');
          return;
        }
        _accessToken = response.access_token;
        // expires_in is seconds; subtract 60s buffer
        _tokenExpiry = Date.now() + Math.max(0, (response.expires_in - 60) * 1000);
        localStorage.setItem('drive_access_token', _accessToken);
        localStorage.setItem('drive_token_expiry', String(_tokenExpiry));

        _updateTopbarIcon();
        App.toast('✅ Google Drive connected!', 'success');

        // Pre-create the folder structure silently
        try {
          await _ensureFolders();
        } catch(e) {
          console.warn('[Drive] folder pre-create failed:', e);
        }

        // Refresh Settings if open
        _refreshSettingsIfOpen();
      }
    });

    _tokenClient.requestAccessToken({ prompt: '' });
  }

  function disconnect() {
    if (_accessToken && typeof google !== 'undefined') {
      try { google.accounts.oauth2.revoke(_accessToken, () => {}); } catch(e) {}
    }
    _clearToken();
    _updateTopbarIcon();
    App.toast('Disconnected from Google Drive', 'info');
    _refreshSettingsIfOpen();
  }

  // Silent token refresh (no popup) — resolves true/false
  async function _silentRefresh() {
    if (!_clientId) return false;
    if (typeof google === 'undefined' || !google?.accounts?.oauth2) return false;
    return new Promise((resolve) => {
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: _clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        prompt: '',
        callback: (response) => {
          if (response.error || !response.access_token) { resolve(false); return; }
          _accessToken = response.access_token;
          _tokenExpiry = Date.now() + Math.max(0, (response.expires_in - 60) * 1000);
          localStorage.setItem('drive_access_token', _accessToken);
          localStorage.setItem('drive_token_expiry', String(_tokenExpiry));
          resolve(true);
        }
      });
      tc.requestAccessToken({ prompt: '' });
    });
  }

  function _refreshSettingsIfOpen() {
    if (document.getElementById('screen-settings')?.classList.contains('active')) {
      Settings.render();
    }
  }

  /* =============================================
     LOW-LEVEL DRIVE API HELPERS
     ============================================= */

  async function _req(url, options = {}) {
    if (!_accessToken) throw new Error('Not connected to Google Drive');

    const headers = {
      'Authorization': `Bearer ${_accessToken}`,
      ...(options.headers || {})
    };

    // Don't spread Content-Type when body is FormData (browser sets it with boundary)
    const res = await fetch(url, { ...options, headers });

    if (res.status === 401) {
      const refreshed = await _silentRefresh();
      if (refreshed) return _req(url, options);   // Retry once
      _clearToken();
      _updateTopbarIcon();
      _refreshSettingsIfOpen();
      throw new Error('Google Drive session expired. Please reconnect in Settings → Google Drive.');
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => String(res.status));
      throw new Error(`Drive API ${res.status}: ${txt.slice(0, 120)}`);
    }

    return res;
  }

  async function _findOrCreateFolder(name, parentId = null) {
    const q = parentId
      ? `'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
      : `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

    const res  = await _req(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`
    );
    const data = await res.json();
    if (data.files?.length) return data.files[0].id;

    const createRes = await _req('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentId ? { parents: [parentId] } : {})
      })
    });
    const folder = await createRes.json();
    return folder.id;
  }

  async function _ensureFolders() {
    if (!_folderId) {
      _folderId = await _findOrCreateFolder('AttendPro');
      localStorage.setItem('drive_folder_id', _folderId);
    }
    if (!_attFolderId) {
      _attFolderId = await _findOrCreateFolder('attendance', _folderId);
      localStorage.setItem('drive_att_folder_id', _attFolderId);
    }
  }

  async function _findFile(name, parentId) {
    const q   = `'${parentId}' in parents and name='${name}' and trashed=false`;
    const res = await _req(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`
    );
    const data = await res.json();
    return data.files?.length ? data.files[0].id : null;
  }

  // Multipart upload — creates or overwrites a file
  async function _upsertFile(name, content, mimeType, parentId) {
    const existingId = await _findFile(name, parentId);
    const metadata   = {
      name, mimeType,
      ...(existingId ? {} : { parents: [parentId] })
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file',     new Blob([content],                   { type: mimeType }));

    const url    = existingId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
    const method = existingId ? 'PATCH' : 'POST';

    // NOTE: Do NOT set Content-Type header here — browser sets it with boundary for FormData
    const res = await _req(url, { method, body: form });
    return res.json();
  }

  /* =============================================
     SYNC OPERATIONS
     ============================================= */

  async function syncMasterData() {
    if (!isConnected()) return false;
    try {
      await _ensureFolders();
      const [employees, sections] = await Promise.all([
        DB.employees.getAll(),
        DB.sections.getAll()
      ]);
      const payload = JSON.stringify({ employees, sections, exportedAt: new Date().toISOString(), appVersion: 1 }, null, 2);
      await _upsertFile('master_data.json', payload, 'application/json', _folderId);
      await _setLastSync();
      return true;
    } catch(e) {
      console.error('[Drive] syncMasterData:', e);
      return false;
    }
  }

  async function syncAttendance(record) {
    if (!isConnected()) return false;
    try {
      await _ensureFolders();
      const company = (record.company || 'Unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
      const shift   = record.shift.replace(/\s+/g, '_');
      const fname   = `${record.date}_${shift}_${company}.json`;
      await _upsertFile(fname, JSON.stringify(record, null, 2), 'application/json', _attFolderId);
      await _setLastSync();
      return true;
    } catch(e) {
      console.error('[Drive] syncAttendance:', e);
      return false;
    }
  }

  // Sync everything: master data + all finalized attendance records
  async function syncAll() {
    if (!isConnected()) { App.toast('Connect Google Drive first (Settings → Google Drive)', 'warning'); return; }
    if (_syncing)        { App.toast('Sync already in progress…', 'info'); return; }

    _syncing = true;
    _updateTopbarIcon();
    App.toast('☁️ Syncing to Google Drive…', 'info');

    let errors = 0;
    try {
      await _ensureFolders();
      const masterOk = await syncMasterData();
      if (!masterOk) errors++;

      const allAtt  = await DB.attendance.getAll();
      const toSync  = allAtt.filter(r => r.isFinalized);
      for (const rec of toSync) {
        const ok = await syncAttendance(rec);
        if (!ok) { errors++; break; }
      }

      if (!errors) {
        App.toast(`✅ Synced ${toSync.length} record${toSync.length !== 1 ? 's' : ''} to Drive`, 'success');
      } else {
        App.toast('⚠️ Sync incomplete — check connection and retry', 'warning');
      }
    } catch(e) {
      console.error('[Drive] syncAll:', e);
      App.toast('Sync failed: ' + e.message, 'error');
    } finally {
      _syncing = false;
      _updateTopbarIcon();
      _refreshSettingsIfOpen();
    }
  }

  // Import master_data.json from Drive → add to local IndexedDB
  async function importFromDrive() {
    if (!isConnected()) { App.toast('Connect Google Drive first', 'warning'); return; }
    App.toast('📥 Fetching master data from Drive…', 'info');

    try {
      await _ensureFolders();
      const fileId = await _findFile('master_data.json', _folderId);
      if (!fileId) { App.toast('No master data found in Drive yet. Sync from another device first.', 'warning'); return; }

      const res  = await _req(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
      const data = await res.json();

      if (!data.employees?.length) { App.toast('No employees found in Drive backup', 'warning'); return; }

      App.confirm(
        `Import ${data.employees.length} employees from Google Drive?\n\nThis will ADD to your existing local data.`,
        async () => {
          const result = await DB.employees.import(data.employees);
          if (data.sections?.length) {
            for (const sec of data.sections) await DB.sections.ensure(sec.name);
          }
          App.toast(`✅ Imported ${result.added} employees from Drive${result.errors.length ? ` (${result.errors.length} skipped)` : ''}`, 'success');
          _refreshSettingsIfOpen();
        }
      );
    } catch(e) {
      App.toast('Import failed: ' + e.message, 'error');
    }
  }

  /* =============================================
     TOPBAR SYNC BUTTON
     ============================================= */

  function _updateTopbarIcon() {
    const btn = document.getElementById('topbar-sync-btn');
    if (!btn) return;

    if (_syncing) {
      btn.textContent = '🔄';
      btn.title       = 'Syncing to Google Drive…';
      btn.classList.add('syncing');
      btn.style.opacity = '1';
    } else if (isConnected()) {
      btn.textContent = '☁️';
      btn.title       = 'Click to sync to Google Drive';
      btn.classList.remove('syncing');
      btn.style.opacity = '1';
    } else {
      btn.textContent = '☁️';
      btn.title       = 'Google Drive — not connected (Settings)';
      btn.classList.remove('syncing');
      btn.style.opacity = '0.35';
    }
  }

  /* =============================================
     HELPERS
     ============================================= */

  async function _setLastSync() {
    await DB.settings.set('drive_last_sync', Date.now());
  }

  async function getLastSyncFormatted() {
    const ts = await DB.settings.get('drive_last_sync');
    if (!ts) return 'Never';
    const diff = Date.now() - ts;
    if (diff < 60_000)    return 'Just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
    if (diff < 86_400_000)return `${Math.floor(diff / 3_600_000)} hr ago`;
    return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  async function setClientId(id) {
    _clientId = id?.trim() || null;
    await DB.settings.set('drive_client_id', _clientId || '');
  }

  function getClientId() {
    return _clientId;
  }

  return {
    init, connect, disconnect, isConnected,
    syncAll, syncMasterData, syncAttendance, importFromDrive,
    getLastSyncFormatted, setClientId, getClientId,
    updateTopbarIcon: _updateTopbarIcon
  };
})();
