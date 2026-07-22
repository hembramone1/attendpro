'use strict';

/* =============================================
   AttendPro — Settings Module
   ============================================= */

const Settings = (() => {
  const COMPANIES = ['MCL', 'ILBL OCP', 'DUMPER WORKSHOP'];
  const SHIFTS = {
    'General': '8:00 AM – 6:00 PM',
    '1st':     '6:00 AM – 2:00 PM',
    '2nd':     '2:00 PM – 10:00 PM',
    '3rd':     '10:00 PM – 6:00 AM'
  };

  let _company = 'MCL';
  let _sections = [];
  let _customFields = [];

  /* -------- Public accessors -------- */

  function getCompany()  { return _company; }
  function getSections() { return _sections; }
  function getShifts()   { return SHIFTS; }
  function getShiftKeys(){ return Object.keys(SHIFTS); }
  function getShiftTime(shift) { return SHIFTS[shift] || ''; }

  async function loadAll() {
    _company      = (await DB.settings.get('company')) || 'MCL';
    _sections     = await DB.sections.getAll();
    _customFields = await DB.customFields.getAll();
    _updateTopbar();
    return { company: _company, sections: _sections, customFields: _customFields };
  }

  async function setCompany(name) {
    _company = name;
    await DB.settings.set('company', name);
    _updateTopbar();
  }

  function _updateTopbar() {
    const el = document.getElementById('topbar-company');
    if (el) el.textContent = _company;
  }

  /* -------- Render -------- */

  async function render() {
    _sections     = await DB.sections.getAll();
    _customFields = await DB.customFields.getAll();

    const screen = document.getElementById('screen-settings');
    // getHTML is async because Drive/Firebase status calls are async
    screen.innerHTML = await getHTML();
    setup();
  }

  async function getHTML() {
    const connected       = Drive.isConnected();
    const clientId        = Drive.getClientId() || '';
    const lastSync        = await Drive.getLastSyncFormatted();
    const firebaseLastSync = await Firebase.getLastSyncFormatted();

    return `
      <div class="screen-title">⚙️ Settings</div>
      <div class="screen-sub">Configure app preferences</div>

      <!-- Company Selection -->
      <div class="settings-section">
        <div class="sec-label">Company / Site</div>
        <div class="company-selector" id="company-selector">
          ${COMPANIES.map(c => `
            <button class="company-btn ${c === _company ? 'active' : ''}" data-company="${c}">
              ${c}
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Shift Timings Info -->
      <div class="settings-section">
        <div class="sec-label">Shift Timings</div>
        <div class="settings-group">
          ${Object.entries(SHIFTS).map(([shift, time]) => `
            <div class="settings-row">
              <div class="settings-row-left">
                <div class="settings-row-label">${shift === 'General' ? '🌅' : shift === '1st' ? '🌄' : shift === '2nd' ? '🌆' : '🌙'} ${shift} Shift</div>
                <div class="settings-row-desc">${time}</div>
              </div>
              <div class="chip chip-default">${shift}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Sections Management -->
      <div class="settings-section">
        <div class="flex items-center justify-between mb-8">
          <div class="sec-label" style="margin-bottom:0">Sections</div>
          <button class="btn btn-sm btn-outline" id="add-section-btn">+ Add Section</button>
        </div>
        <div id="add-section-form" style="display:none;" class="card mb-12">
          <div class="form-group">
            <input class="form-input" id="new-section-input" placeholder="e.g. Auto-electrical Section" maxlength="60">
          </div>
          <div class="flex gap-8">
            <button class="btn btn-sm btn-primary" id="save-section-btn">Save</button>
            <button class="btn btn-sm btn-ghost" id="cancel-section-btn">Cancel</button>
          </div>
        </div>
        <div class="section-list" id="sections-list">
          ${renderSectionTags()}
        </div>
      </div>

      <!-- Custom Fields -->
      <div class="settings-section">
        <div class="flex items-center justify-between mb-8">
          <div class="sec-label" style="margin-bottom:0">Custom Employee Fields</div>
          <button class="btn btn-sm btn-outline" id="add-field-btn">+ Add Field</button>
        </div>
        <div id="add-field-form" style="display:none;" class="card mb-12">
          <div class="form-group">
            <input class="form-input" id="new-field-input" placeholder="e.g. Blood Group, Contract Type" maxlength="40">
          </div>
          <div class="flex gap-8">
            <button class="btn btn-sm btn-primary" id="save-field-btn">Save</button>
            <button class="btn btn-sm btn-ghost" id="cancel-field-btn">Cancel</button>
          </div>
        </div>
        <div class="section-list" id="fields-list">
          ${renderFieldTags()}
        </div>
      </div>

      <!-- ══════════════════════════════════════
           GOOGLE DRIVE SYNC
           ══════════════════════════════════════ -->
      <div class="settings-section">
        <div class="sec-label">☁️ Google Drive Sync</div>

        ${!connected ? /* ── NOT CONNECTED STATE ── */ `
          <div class="drive-setup-card card mb-8">
            <div class="drive-intro">
              <div class="drive-intro-icon">☁️</div>
              <div>
                <div style="font-weight:700;font-size:14px;margin-bottom:4px">Backup &amp; multi-device sync</div>
                <div style="font-size:12px;color:var(--text-secondary);line-height:1.5">
                  Attendance data is synced to your Google Drive folder &quot;AttendPro/&quot;. Free, private, and works offline too.
                </div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="form-group">
              <label class="form-label">Google OAuth Client ID <span style="color:var(--danger)">*</span></label>
              <input class="form-input" id="drive-client-id-input"
                placeholder="xxxx.apps.googleusercontent.com"
                value="${clientId}"
                autocomplete="off" spellcheck="false">
            </div>
            <button class="btn btn-primary btn-full" id="drive-connect-btn">
              <span>🔗</span> Connect Google Drive
            </button>
            <div style="margin-top:12px;text-align:center;font-size:12px;color:var(--text-muted)">
              Don't have a Client ID? 
              <button class="btn-link" id="drive-guide-toggle-btn" style="color:var(--accent);background:none;border:none;cursor:pointer;font-size:12px;text-decoration:underline">See setup guide ↓</button>
            </div>
          </div>

          <!-- Collapsible Setup Guide -->
          <div id="drive-guide-box" style="display:none;" class="card drive-guide">
            <div class="drive-guide-title">📋 One-time Setup (5 minutes)</div>
            <ol class="drive-guide-steps">
              <li>Go to <strong>console.cloud.google.com</strong></li>
              <li>Create a new project (e.g. <em>AttendPro</em>)</li>
              <li><strong>APIs &amp; Services → Library</strong> → search &quot;Google Drive API&quot; → Enable</li>
              <li><strong>APIs &amp; Services → OAuth consent screen</strong>
                <ul><li>User Type: <strong>External</strong></li><li>App name: <strong>AttendPro</strong></li><li>Fill your email → Save &amp; Continue (skip optional steps)</li></ul>
              </li>
              <li><strong>APIs &amp; Services → Credentials → Create Credentials → OAuth Client ID</strong>
                <ul>
                  <li>Type: <strong>Web application</strong></li>
                  <li>Authorized JavaScript origins: add <code>http://localhost:3000</code></li>
                  <li>Also add your phone's local IP if accessing from phone, e.g. <code>http://192.168.1.x:3000</code></li>
                </ul>
              </li>
              <li>Click <strong>Create</strong> → Copy the <strong>Client ID</strong> shown</li>
              <li>Paste it above and tap <strong>Connect Google Drive</strong></li>
            </ol>
            <div style="margin-top:8px;padding:8px;background:rgba(99,102,241,0.1);border-radius:6px;font-size:11px;color:var(--text-secondary)">
              💡 On first connect Google may ask you to verify your app — click <strong>Advanced → Go to AttendPro (unsafe)</strong> since it's your own app. You can publish the app later to remove this warning.
            </div>
          </div>

        ` : /* ── CONNECTED STATE ── */ `
          <!-- Status card -->
          <div class="drive-status-card">
            <div class="drive-status-icon">✅</div>
            <div class="drive-status-info">
              <div class="drive-status-label">Google Drive Connected</div>
              <div class="drive-status-sub">Last synced: <strong>${lastSync}</strong></div>
            </div>
            <button class="btn btn-sm btn-danger" id="drive-disconnect-btn">Disconnect</button>
          </div>

          <!-- Actions -->
          <div class="settings-group">
            <div class="settings-row">
              <div class="settings-row-left">
                <div class="settings-row-label">🔄 Sync Now</div>
                <div class="settings-row-desc">Upload all attendance to Drive</div>
              </div>
              <button class="btn btn-sm btn-primary" id="drive-sync-now-btn">Sync</button>
            </div>
            <div class="settings-row">
              <div class="settings-row-left">
                <div class="settings-row-label">📥 Import from Drive</div>
                <div class="settings-row-desc">Add employees from another device</div>
              </div>
              <button class="btn btn-sm btn-secondary" id="drive-import-btn">Import</button>
            </div>
            <div class="settings-row">
              <div class="settings-row-left">
                <div class="settings-row-label">⚡ Auto-sync on submit</div>
                <div class="settings-row-desc">Sync instantly when attendance is finalized</div>
              </div>
              <label class="toggle-switch" title="Auto-sync">
                <input type="checkbox" id="drive-autosync-toggle">
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
            </div>
          </div>
        `}
      </div>

      <!-- ══════════════════════════════════════
           FIREBASE REALTIME DATABASE
           ══════════════════════════════════════ -->
      <div class="settings-section">
        <div class="sec-label">🔥 Firebase Sync</div>

        ${!Firebase.isConfigured() ? /* ── NOT CONFIGURED ── */ `
          <div class="firebase-intro-card card mb-8">
            <div class="drive-intro">
              <div class="drive-intro-icon">🔥</div>
              <div>
                <div style="font-weight:700;font-size:14px;margin-bottom:4px">Real-time sync — Completely Free</div>
                <div style="font-size:12px;color:var(--text-secondary);line-height:1.5">
                  Paste your Firebase Database URL below. All devices with the same project sync instantly — no OAuth, no login flow.
                </div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="form-group">
              <label class="form-label">Firebase Database URL <span style="color:var(--danger)">*</span></label>
              <input class="form-input" id="firebase-url-input"
                placeholder="https://your-project-default-rtdb.firebaseio.com"
                autocomplete="off" spellcheck="false" style="font-size:12px">
            </div>

            <div style="margin-bottom:12px;font-size:12px;color:var(--text-secondary)">
              <strong>Optional:</strong> If you set Database Rules to private, also add your Web API key:
            </div>
            <div class="form-group">
              <input class="form-input" id="firebase-apikey-input"
                placeholder="Web API Key (optional — leave blank for public mode)"
                autocomplete="off" style="font-size:12px">
            </div>

            <button class="btn btn-primary btn-full" id="firebase-connect-btn" style="background:linear-gradient(135deg,#ff6b35,#f7c59f)">
              🔥 Connect Firebase
            </button>

            <div style="margin-top:12px;text-align:center;font-size:12px;color:var(--text-muted)">
              <button class="btn-link" id="firebase-guide-toggle" style="color:#ff6b35;background:none;border:none;cursor:pointer;font-size:12px;text-decoration:underline">Setup guide (3 min) ↓</button>
            </div>
          </div>

          <!-- Collapsible Setup Guide -->
          <div id="firebase-guide-box" style="display:none" class="card" style="border:1px solid rgba(255,107,53,0.25);background:rgba(255,107,53,0.04)">
            <div style="font-size:13px;font-weight:700;color:#ff6b35;margin-bottom:10px">📋 Setup (free, 3 minutes)</div>
            <ol class="drive-guide-steps">
              <li>Go to <strong>console.firebase.google.com</strong></li>
              <li>Click <strong>Add project</strong> → name it <em>AttendPro</em> → Continue (disable Analytics is fine) → <strong>Create project</strong></li>
              <li>In the left menu → <strong>Build → Realtime Database</strong></li>
              <li>Click <strong>Create Database</strong> → choose your nearest region → Start in <strong>Test mode</strong> (for now)</li>
              <li>You'll see your Database URL like: <code>https://attendpro-12345-default-rtdb.firebaseio.com</code> — <strong>copy this URL</strong></li>
              <li>Paste it above and tap <strong>Connect Firebase</strong></li>
            </ol>
            <div style="margin-top:8px;padding:8px;background:rgba(255,107,53,0.08);border-radius:6px;font-size:11px;color:var(--text-secondary)">
              ⚠️ Test mode expires in 30 days. Before then, go to <strong>Realtime Database → Rules</strong> and set both <code>read</code> and <code>write</code> to <code>true</code> to keep it open. This is safe since only people with the DB URL can access it.
            </div>
          </div>

        ` : /* ── CONFIGURED ── */ `
          <!-- Status card -->
          <div class="firebase-status-card">
            <div style="font-size:24px">🔥</div>
            <div class="drive-status-info">
              <div style="font-size:14px;font-weight:700;color:#ff6b35">Firebase Connected</div>
              <div class="drive-status-sub">Last synced: <strong>${firebaseLastSync}</strong></div>
            </div>
            <button class="btn btn-sm btn-danger" id="firebase-disconnect-btn">Disconnect</button>
          </div>

          <!-- Actions -->
          <div class="settings-group">
            <div class="settings-row">
              <div class="settings-row-left">
                <div class="settings-row-label">🔄 Push to Firebase</div>
                <div class="settings-row-desc">Upload all local data to Firebase</div>
              </div>
              <button class="btn btn-sm btn-primary" id="firebase-push-btn" style="background:#ff6b35">Push</button>
            </div>
            <div class="settings-row">
              <div class="settings-row-left">
                <div class="settings-row-label">📥 Pull from Firebase</div>
                <div class="settings-row-desc">Download &amp; merge data from Firebase</div>
              </div>
              <button class="btn btn-sm btn-secondary" id="firebase-pull-btn">Pull</button>
            </div>
            <div class="settings-row">
              <div class="settings-row-left">
                <div class="settings-row-label">⚡ Auto-push on submit</div>
                <div class="settings-row-desc">Push attendance record when finalized</div>
              </div>
              <label class="toggle-switch" title="Firebase auto-push">
                <input type="checkbox" id="firebase-autopush-toggle">
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </label>
            </div>
          </div>
        `}
      </div>

      <!-- About -->
      <div class="settings-section">
        <div class="sec-label">About</div>
        <div class="settings-group">
          <div class="settings-row">
            <div class="settings-row-left">
              <div class="settings-row-label">AttendPro</div>
              <div class="settings-row-desc">Industrial Attendance Manager v1.0</div>
            </div>
            <div class="chip chip-accent">PWA</div>
          </div>
          <div class="settings-row">
            <div class="settings-row-left">
              <div class="settings-row-label">Install as App</div>
              <div class="settings-row-desc">Add to home screen for best experience</div>
            </div>
            <button class="btn btn-sm btn-outline" id="install-btn">Install</button>
          </div>
          <div class="settings-row">
            <div class="settings-row-left">
              <div class="settings-row-label" style="color:var(--danger)">Clear All Data</div>
              <div class="settings-row-desc">Delete all employees and attendance</div>
            </div>
            <button class="btn btn-sm btn-danger" id="clear-data-btn">Clear</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderSectionTags() {
    if (!_sections.length) return '<span class="text-sm text-muted">No sections added yet</span>';
    return _sections.sort((a,b) => a.name.localeCompare(b.name)).map(s => `
      <span class="section-tag">
        ${s.name}
        <span class="tag-del" data-section-id="${s.id}" title="Delete">✕</span>
      </span>
    `).join('');
  }

  function renderFieldTags() {
    if (!_customFields.length) return '<span class="text-sm text-muted">No custom fields added yet</span>';
    return _customFields.map(f => `
      <span class="section-tag">
        ${f.name}
        <span class="tag-del" data-field-id="${f.id}" title="Delete">✕</span>
      </span>
    `).join('');
  }

  function setup() {
    // Company selector
    document.querySelectorAll('.company-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await setCompany(btn.dataset.company);
        document.querySelectorAll('.company-btn').forEach(b => b.classList.toggle('active', b.dataset.company === _company));
        App.toast('Company set to ' + _company, 'success');
      });
    });

    // Section management
    const addSectionBtn  = document.getElementById('add-section-btn');
    const addSectionForm = document.getElementById('add-section-form');
    const newSectionInput = document.getElementById('new-section-input');

    addSectionBtn.addEventListener('click', () => {
      addSectionForm.style.display = 'block';
      newSectionInput.focus();
    });
    document.getElementById('cancel-section-btn').addEventListener('click', () => {
      addSectionForm.style.display = 'none';
      newSectionInput.value = '';
    });
    document.getElementById('save-section-btn').addEventListener('click', () => saveSection());
    newSectionInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveSection(); });

    // Section delete (event delegation)
    document.getElementById('sections-list').addEventListener('click', async (e) => {
      const sectionId = e.target.dataset.sectionId;
      if (!sectionId) return;
      App.confirm('Delete this section? Employees in this section won\'t be affected.', async () => {
        await DB.sections.delete(sectionId);
        _sections = _sections.filter(s => s.id !== sectionId);
        document.getElementById('sections-list').innerHTML = renderSectionTags();
        App.toast('Section deleted', 'info');
      });
    });

    // Custom field management
    const addFieldBtn  = document.getElementById('add-field-btn');
    const addFieldForm = document.getElementById('add-field-form');
    const newFieldInput = document.getElementById('new-field-input');

    addFieldBtn.addEventListener('click', () => {
      addFieldForm.style.display = 'block';
      newFieldInput.focus();
    });
    document.getElementById('cancel-field-btn').addEventListener('click', () => {
      addFieldForm.style.display = 'none';
      newFieldInput.value = '';
    });
    document.getElementById('save-field-btn').addEventListener('click', () => saveField());
    newFieldInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveField(); });

    document.getElementById('fields-list').addEventListener('click', async (e) => {
      const fieldId = e.target.dataset.fieldId;
      if (!fieldId) return;
      App.confirm('Delete this custom field?', async () => {
        await DB.customFields.delete(fieldId);
        _customFields = _customFields.filter(f => f.id !== fieldId);
        document.getElementById('fields-list').innerHTML = renderFieldTags();
        App.toast('Field deleted', 'info');
      });
    });

    // Install button
    const installBtn = document.getElementById('install-btn');
    if (window._deferredInstallPrompt) {
      installBtn.addEventListener('click', async () => {
        window._deferredInstallPrompt.prompt();
        const { outcome } = await window._deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') App.toast('App installed!', 'success');
        window._deferredInstallPrompt = null;
      });
    } else {
      installBtn.textContent = 'Already Installed';
      installBtn.disabled = true;
    }

    // Clear data
    document.getElementById('clear-data-btn').addEventListener('click', () => {
      App.confirm('⚠️ This will permanently delete ALL employee and attendance data. This cannot be undone!', async () => {
        await DB.employees.clearAll();
        await DB.attendance.clearAll();
        App.toast('All data cleared', 'warning');
      });
    });

    // ── Google Drive handlers ──────────────────────────────────

    // Connect button (not-connected state)
    const connectBtn = document.getElementById('drive-connect-btn');
    if (connectBtn) {
      connectBtn.addEventListener('click', async () => {
        const input = document.getElementById('drive-client-id-input');
        const id    = input?.value.trim();
        if (!id) { App.toast('Paste your Google Client ID first', 'error'); input?.focus(); return; }
        await Drive.setClientId(id);
        Drive.connect();
      });
    }

    // Setup guide collapsible toggle
    const guideToggle = document.getElementById('drive-guide-toggle-btn');
    const guideBox    = document.getElementById('drive-guide-box');
    if (guideToggle && guideBox) {
      guideToggle.addEventListener('click', () => {
        const open = guideBox.style.display !== 'none';
        guideBox.style.display = open ? 'none' : 'block';
        guideToggle.textContent = open ? 'See setup guide ↓' : 'Hide setup guide ↑';
      });
    }

    // Disconnect button (connected state)
    document.getElementById('drive-disconnect-btn')
      ?.addEventListener('click', () => {
        App.confirm('Disconnect Google Drive? Your local data won\'t be deleted.', () => Drive.disconnect());
      });

    // Sync Now
    document.getElementById('drive-sync-now-btn')
      ?.addEventListener('click', () => Drive.syncAll());

    // Import from Drive
    document.getElementById('drive-import-btn')
      ?.addEventListener('click', () => Drive.importFromDrive());

    // Auto-sync toggle — persist preference
    const autoToggle = document.getElementById('drive-autosync-toggle');
    if (autoToggle) {
      DB.settings.get('drive_autosync').then(val => {
        autoToggle.checked = val !== false && val !== 'false';
      });
      autoToggle.addEventListener('change', async () => {
        await DB.settings.set('drive_autosync', autoToggle.checked);
        App.toast(`Auto-sync ${autoToggle.checked ? 'enabled' : 'disabled'}`, 'info', 2000);
      });
    }

    // ── Firebase handlers ──────────────────────────────────────

    // Connect button
    const fbConnectBtn = document.getElementById('firebase-connect-btn');
    if (fbConnectBtn) {
      fbConnectBtn.addEventListener('click', async () => {
        const urlInput = document.getElementById('firebase-url-input');
        const keyInput = document.getElementById('firebase-apikey-input');
        const dbUrl    = urlInput?.value.trim();
        const apiKey   = keyInput?.value.trim() || null;

        if (!dbUrl) {
          App.toast('Paste your Firebase Database URL first', 'error');
          urlInput?.focus();
          return;
        }

        fbConnectBtn.textContent = '⏳ Connecting…';
        fbConnectBtn.disabled    = true;

        try {
          await Firebase.configure({ dbUrl, apiKey });
          App.toast('🔥 Firebase connected!', 'success');
          Settings.render();
        } catch(e) {
          App.toast('Connection failed: ' + e.message, 'error');
          fbConnectBtn.textContent = '🔥 Connect Firebase';
          fbConnectBtn.disabled    = false;
        }
      });
    }

    // Firebase setup guide toggle
    const fbGuideToggle = document.getElementById('firebase-guide-toggle');
    const fbGuideBox    = document.getElementById('firebase-guide-box');
    if (fbGuideToggle && fbGuideBox) {
      fbGuideToggle.addEventListener('click', () => {
        const open = fbGuideBox.style.display !== 'none';
        fbGuideBox.style.display = open ? 'none' : 'block';
        fbGuideToggle.textContent = open ? 'Setup guide (3 min) ↓' : 'Hide setup guide ↑';
      });
    }

    // Disconnect Firebase
    document.getElementById('firebase-disconnect-btn')
      ?.addEventListener('click', () => {
        App.confirm('Disconnect Firebase? Your local data won\'t be deleted.', async () => {
          await Firebase.disconnect();
          Settings.render();
        });
      });

    // Push to Firebase
    document.getElementById('firebase-push-btn')
      ?.addEventListener('click', () => Firebase.syncAll());

    // Pull from Firebase
    document.getElementById('firebase-pull-btn')
      ?.addEventListener('click', () => Firebase.pullAll());

    // Auto-push toggle
    const fbAutoToggle = document.getElementById('firebase-autopush-toggle');
    if (fbAutoToggle) {
      DB.settings.get('firebase_autopush').then(val => {
        fbAutoToggle.checked = val !== false && val !== 'false';
      });
      fbAutoToggle.addEventListener('change', async () => {
        await DB.settings.set('firebase_autopush', fbAutoToggle.checked);
        App.toast(`Firebase auto-push ${fbAutoToggle.checked ? 'enabled' : 'disabled'}`, 'info', 2000);
      });
    }
  }

  async function saveSection() {
    const input = document.getElementById('new-section-input');
    const name  = input.value.trim();
    if (!name) { App.toast('Please enter a section name', 'error'); return; }

    const exists = _sections.find(s => s.name.toLowerCase() === name.toLowerCase());
    if (exists) { App.toast('Section already exists', 'warning'); return; }

    const s = await DB.sections.add(name);
    _sections.push(s);
    document.getElementById('add-section-form').style.display = 'none';
    input.value = '';
    document.getElementById('sections-list').innerHTML = renderSectionTags();
    App.toast('Section added', 'success');
  }

  async function saveField() {
    const input = document.getElementById('new-field-input');
    const name  = input.value.trim();
    if (!name) { App.toast('Please enter a field name', 'error'); return; }

    const exists = _customFields.find(f => f.name.toLowerCase() === name.toLowerCase());
    if (exists) { App.toast('Field already exists', 'warning'); return; }

    const f = await DB.customFields.add(name);
    _customFields.push(f);
    document.getElementById('add-field-form').style.display = 'none';
    input.value = '';
    document.getElementById('fields-list').innerHTML = renderFieldTags();
    App.toast('Custom field added', 'success');
  }

  return {
    render, loadAll,
    getCompany, getSections, getShifts, getShiftKeys, getShiftTime,
    COMPANIES
  };
})();
