'use strict';

/* =============================================
   AttendPro — Firebase Realtime Database Sync
   =============================================
   Uses the Firebase REST API directly (no SDK).
   No build step, no npm, just fetch() calls.
   
   Data paths in Firebase:
     attendpro/
       employees/          ← { empId: {...empData} }
       attendance/         ← { "YYYY-MM-DD_Shift_Company": {...record} }
       sections/           ← { sectionId: { name, createdAt } }
       meta/lastSync       ← timestamp
   ============================================= */

const Firebase = (() => {
  let _dbUrl   = null;   // e.g. https://YOUR-PROJECT.firebaseio.com
  let _apiKey  = null;   // Firebase Web API key (for auth, optional for public DB)
  let _syncing = false;
  let _initialized = false;

  const ROOT_PATH = 'attendpro';

  /* =============================================
     INIT
     ============================================= */

  async function init() {
    const cfg = await _loadConfig();
    if (cfg) {
      _dbUrl  = cfg.dbUrl.replace(/\/$/, '');  // strip trailing slash
      _apiKey = cfg.apiKey || null;
      _initialized = true;
    }
    _updateStatusIndicator();
  }

  function isConfigured() { return _initialized && !!_dbUrl; }

  async function _loadConfig() {
    try {
      const raw = await DB.settings.get('firebase_config');
      if (!raw) return null;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch(e) { return null; }
  }

  async function configure(configObj) {
    // Accept either the full Firebase config object OR just the databaseURL string
    let dbUrl, apiKey;

    if (typeof configObj === 'string') {
      // User pasted raw databaseURL
      dbUrl  = configObj.trim();
      apiKey = null;
    } else {
      dbUrl  = configObj.databaseURL || configObj.dbUrl || '';
      apiKey = configObj.apiKey || null;
    }

    // Normalize URL
    dbUrl = dbUrl.replace(/\/$/, '');
    if (!dbUrl.startsWith('https://')) {
      throw new Error('Database URL must start with https://');
    }

    // Test the connection before saving
    await _testConnection(dbUrl, apiKey);

    // Save config
    const stored = { dbUrl, apiKey };
    await DB.settings.set('firebase_config', JSON.stringify(stored));
    _dbUrl  = dbUrl;
    _apiKey = apiKey;
    _initialized = true;
    _updateStatusIndicator();
  }

  async function disconnect() {
    await DB.settings.set('firebase_config', '');
    _dbUrl       = null;
    _apiKey      = null;
    _initialized = false;
    _updateStatusIndicator();
  }

  async function _testConnection(dbUrl, apiKey) {
    // Write a tiny test node then read it back
    const testUrl = `${dbUrl}/${ROOT_PATH}/meta/connectionTest.json${apiKey ? `?auth=${apiKey}` : ''}`;
    const res = await fetch(testUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, ts: Date.now() })
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => res.status);
      throw new Error(`Cannot reach Firebase: ${res.status} — ${txt}`);
    }
  }

  /* =============================================
     LOW-LEVEL REST HELPERS
     ============================================= */

  function _url(path) {
    const base = `${_dbUrl}/${ROOT_PATH}/${path}.json`;
    return _apiKey ? `${base}?auth=${_apiKey}` : base;
  }

  async function _get(path) {
    const res = await fetch(_url(path));
    if (!res.ok) throw new Error(`Firebase GET failed: ${res.status}`);
    const data = await res.json();
    return data;   // null if node doesn't exist
  }

  async function _put(path, value) {
    const res = await fetch(_url(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    });
    if (!res.ok) throw new Error(`Firebase PUT failed: ${res.status}`);
    return res.json();
  }

  async function _patch(path, value) {
    const res = await fetch(_url(path), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    });
    if (!res.ok) throw new Error(`Firebase PATCH failed: ${res.status}`);
    return res.json();
  }

  async function _delete(path) {
    const res = await fetch(_url(path), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Firebase DELETE failed: ${res.status}`);
  }

  /* =============================================
     EMPLOYEE SYNC
     ============================================= */

  // Upload/update a single employee
  async function pushEmployee(emp) {
    if (!isConfigured()) return false;
    try {
      const safe = _sanitizeKey(emp.id);
      await _put(`employees/${safe}`, {
        ...emp,
        _syncedAt: Date.now()
      });
      return true;
    } catch(e) {
      console.error('[Firebase] pushEmployee:', e);
      return false;
    }
  }

  // Remove a single employee
  async function deleteEmployee(empId) {
    if (!isConfigured()) return;
    try { await _delete(`employees/${_sanitizeKey(empId)}`); } catch(e) {}
  }

  // Upload all local employees to Firebase
  async function pushAllEmployees() {
    if (!isConfigured()) return false;
    try {
      const employees = await DB.employees.getAll();
      const sections  = await DB.sections.getAll();
      const empMap = {};
      employees.forEach(e => { empMap[_sanitizeKey(e.id)] = { ...e, _syncedAt: Date.now() }; });
      const secMap = {};
      sections.forEach(s => { secMap[_sanitizeKey(s.id)] = { ...s, _syncedAt: Date.now() }; });

      await _patch('', { employees: empMap, sections: secMap, 'meta/lastSync': Date.now() });
      await DB.settings.set('firebase_last_sync', Date.now());
      return true;
    } catch(e) {
      console.error('[Firebase] pushAllEmployees:', e);
      return false;
    }
  }

  // Pull employees from Firebase and merge into local DB
  async function pullEmployees() {
    if (!isConfigured()) return { added: 0, errors: [] };
    const data = await _get('employees');
    if (!data) return { added: 0, errors: [] };

    const remoteEmps = Object.values(data);
    const result = await DB.employees.import(remoteEmps);

    // Also pull sections
    const secData = await _get('sections').catch(() => null);
    if (secData) {
      for (const sec of Object.values(secData)) {
        await DB.sections.ensure(sec.name).catch(() => {});
      }
    }

    await DB.settings.set('firebase_last_sync', Date.now());
    return result;
  }

  /* =============================================
     ATTENDANCE SYNC
     ============================================= */

  // Push one attendance record
  async function pushAttendance(record) {
    if (!isConfigured()) return false;
    try {
      const key = _attKey(record);
      await _put(`attendance/${key}`, { ...record, _syncedAt: Date.now() });
      await DB.settings.set('firebase_last_sync', Date.now());
      return true;
    } catch(e) {
      console.error('[Firebase] pushAttendance:', e);
      return false;
    }
  }

  // Pull all attendance records from Firebase and merge
  async function pullAttendance() {
    if (!isConfigured()) return 0;
    const data = await _get('attendance');
    if (!data) return 0;

    let count = 0;
    for (const rec of Object.values(data)) {
      await DB.attendance.save(rec).catch(() => {});
      count++;
    }
    await DB.settings.set('firebase_last_sync', Date.now());
    return count;
  }

  /* =============================================
     FULL SYNC OPERATIONS
     ============================================= */

  // Push everything local → Firebase
  async function syncAll() {
    if (!isConfigured()) {
      App.toast('Set up Firebase first (Settings → Firebase Sync)', 'warning');
      return;
    }
    if (_syncing) { App.toast('Sync already in progress…', 'info'); return; }

    _syncing = true;
    _updateStatusIndicator();
    App.toast('🔥 Syncing to Firebase…', 'info');

    let ok = false;
    try {
      // Push master data
      await pushAllEmployees();
      // Push all finalized attendance
      const allAtt = await DB.attendance.getAll();
      const finalized = allAtt.filter(r => r.isFinalized);
      for (const rec of finalized) await pushAttendance(rec);

      await DB.settings.set('firebase_last_sync', Date.now());
      ok = true;
      App.toast(`✅ Synced ${finalized.length} attendance records to Firebase`, 'success');
    } catch(e) {
      App.toast('Firebase sync failed: ' + e.message, 'error');
      console.error('[Firebase] syncAll:', e);
    } finally {
      _syncing = false;
      _updateStatusIndicator();
      _refreshSettingsIfOpen();
    }
  }

  // Pull everything Firebase → local (merge)
  async function pullAll() {
    if (!isConfigured()) { App.toast('Set up Firebase first', 'warning'); return; }

    App.toast('📥 Pulling from Firebase…', 'info');
    try {
      const empResult = await pullEmployees();
      const attCount  = await pullAttendance();
      App.toast(
        `✅ Pulled ${empResult.added} employees and ${attCount} attendance records`,
        'success'
      );
      _refreshSettingsIfOpen();
    } catch(e) {
      App.toast('Pull failed: ' + e.message, 'error');
    }
  }

  /* =============================================
     UI HELPERS
     ============================================= */

  function _updateStatusIndicator() {
    // Update the small Firebase indicator dot in topbar (if present)
    const dot = document.getElementById('topbar-firebase-dot');
    if (!dot) return;
    if (_syncing) {
      dot.textContent = '🔄'; dot.style.opacity = '1';
    } else if (isConfigured()) {
      dot.textContent = '🔥'; dot.style.opacity = '1';
    } else {
      dot.textContent = '🔥'; dot.style.opacity = '0.3';
    }
  }

  function _refreshSettingsIfOpen() {
    if (document.getElementById('screen-settings')?.classList.contains('active')) {
      Settings.render();
    }
  }

  async function getLastSyncFormatted() {
    const ts = await DB.settings.get('firebase_last_sync');
    if (!ts) return 'Never';
    const diff = Date.now() - ts;
    if (diff < 60_000)     return 'Just now';
    if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)} min ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
    return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  async function getProjectId() {
    // Extract project ID from database URL: https://PROJECT-default-rtdb.firebaseio.com
    if (!_dbUrl) return null;
    const m = _dbUrl.match(/https:\/\/([^.]+)/);
    return m ? m[1] : _dbUrl;
  }

  /* =============================================
     INTERNAL HELPERS
     ============================================= */

  // Firebase key-safe version of a string (no . $ # [ ] / )
  function _sanitizeKey(str) {
    return String(str || '').replace(/[.#$\[\]/]/g, '_');
  }

  // Consistent key for an attendance record
  function _attKey(record) {
    const date    = _sanitizeKey(record.date);
    const shift   = _sanitizeKey(record.shift);
    const company = _sanitizeKey(record.company);
    return `${date}_${shift}_${company}`;
  }

  return {
    init, configure, disconnect, isConfigured,
    pushEmployee, deleteEmployee, pushAllEmployees, pullEmployees,
    pushAttendance, pullAttendance,
    syncAll, pullAll,
    getLastSyncFormatted, getProjectId
  };
})();
