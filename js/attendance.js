'use strict';

/* =============================================
   AttendPro — Attendance Module
   ============================================= */

const Attendance = (() => {
  let _state = {
    date:    '',
    shift:   'General',
    company: '',
    employees: [],
    sections:  [],
    presentIds: new Set(),
    existingRecord: null,
    isFinalized: false,
    filterSec: 'all'
  };

  /* -------- Render -------- */

  async function render() {
    try {
      const today = new Date();
      _state.date    = toYMD(today);
      _state.company = Settings.getCompany();
      _state.employees = (await DB.employees.getAll()) || [];
      _state.sections  = (await DB.sections.getAll()) || [];
      _state.presentIds = new Set();
      _state.filterSec  = 'all';

      _state.existingRecord = await DB.attendance.getByKey(_state.date, _state.shift, _state.company);
      if (_state.existingRecord) {
        _state.isFinalized = !!_state.existingRecord.isFinalized;
        (_state.existingRecord.records || [])
          .filter(r => r && r.status === 'present')
          .forEach(r => _state.presentIds.add(r.empId));
      } else {
        _state.isFinalized = false;
      }

      const screen = document.getElementById('screen-attendance');
      if (!screen) return;
      screen.innerHTML = getHTML();
      setupEvents();
      refreshCounter();
      renderEmployeeList();
      refreshPresentChips();
    } catch(err) {
      console.error('Error rendering Attendance screen:', err);
      const screen = document.getElementById('screen-attendance');
      if (screen) {
        screen.innerHTML = `<div style="padding:30px;text-align:center;color:var(--danger)">⚠️ Error loading Attendance: ${esc(err.message)}</div>`;
      }
    }
  }

  function getSectionPresentCount(secName) {
    const isForemenTab = secName === '__foremen__';
    const secEmps = (_state.employees || []).filter(emp => {
      if (!emp) return false;
      const desig = (emp.designation || '').toLowerCase().trim();
      const isF = desig.includes('foreman') || desig.includes('foremen');
      if (isForemenTab) return isF;
      return (emp.section || '') === secName && !isF;
    });
    return secEmps.filter(e => e && _state.presentIds && _state.presentIds.has(e.id)).length;
  }

  function getSectionTabClass(secName) {
    if (!secName || secName === 'all') return '';
    const presentCnt = getSectionPresentCount(secName);
    if (presentCnt > 0) {
      return 'sec-has-present'; // Light Green
    } else if (_state.isFinalized) {
      return 'sec-zero-finalized'; // Light Red when finalized and section has 0 attendance
    }
    return '';
  }

  function updateSectionTabs() {
    const container = document.getElementById('att-sec-tabs');
    if (!container) return;

    container.querySelectorAll('.sec-tab').forEach(btn => {
      const secName = btn.dataset.sec;
      if (!secName || secName === 'all') return;

      btn.classList.remove('sec-has-present', 'sec-zero-finalized');
      const cls = getSectionTabClass(secName);
      if (cls) btn.classList.add(cls);
    });
  }

  /* -------- HTML Template -------- */

  function getHTML() {
    const shiftKeys = Settings.getShiftKeys() || ['General'];
    const total = (_state.employees || []).length;

    return `
      <div class="screen-title">✅ Attendance</div>
      <div class="screen-sub">${esc(Settings.getCompany())}</div>

      <!-- Controls: Date + Shift -->
      <div class="att-controls">
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">📅 Date</label>
          <input type="date" class="form-input" id="att-date" value="${_state.date}" max="${toYMD(new Date())}">
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">🕐 Shift</label>
          <select class="form-select" id="att-shift">
            ${shiftKeys.map(s => `<option value="${s}" ${s === _state.shift ? 'selected' : ''}>${s}${s === 'General' ? ' ★' : ''}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- Status bar -->
      <div id="att-status-wrap"></div>

      ${_state.isFinalized ? '' : `
        <!-- Search to mark present -->
        <div class="att-search-wrap" style="position:relative; z-index:55;">
          <span class="att-search-icon">🔍</span>
          <input class="att-search" id="att-search" placeholder="Type name to mark present…" autocomplete="off">
          <div class="att-dropdown" id="att-dropdown" style="display:none;"></div>
        </div>

        <!-- Present chips -->
        <div class="present-wrap">
          <div class="sec-label">Present Employees</div>
          <div class="present-chips" id="present-chips"></div>
        </div>
      `}

      <!-- Counter -->
      <div class="att-counter" id="att-counter">
        <div>
          <div class="counter-label">Present</div>
          <div>
            <span class="counter-nums" id="cnt-present">0</span>
            <span class="counter-of"> / </span>
            <span class="counter-of">${total} Total</span>
          </div>
        </div>
        <div style="text-align:right">
          <div class="counter-label">Absent</div>
          <div class="counter-nums" style="color:var(--danger)" id="cnt-absent">0</div>
        </div>
      </div>

      <!-- Section & Category filter for employee list -->
      <div class="section-tabs" id="att-sec-tabs" style="margin-bottom:8px">
        <button class="sec-tab ${_state.filterSec === 'all' ? 'active' : ''}" data-sec="all">All</button>
        <button class="sec-tab ${_state.filterSec === '__foremen__' ? 'active' : ''} ${getSectionTabClass('__foremen__')}" data-sec="__foremen__">👷 Foremen</button>
        ${(_state.sections || []).filter(s => s && s.name).sort((a,b) => (a.name || '').localeCompare(b.name || '')).map(s => {
          const cls = getSectionTabClass(s.name);
          const activeCls = _state.filterSec === s.name ? 'active' : '';
          return `<button class="sec-tab ${activeCls} ${cls}" data-sec="${esc(s.name)}">${esc(s.name)}</button>`;
        }).join('')}
      </div>

      <!-- Full employee list -->
      <div class="sec-label" style="margin-bottom:6px">All Employees</div>
      <div class="emp-scroll-list" id="att-emp-list"></div>

      <!-- Bottom actions -->
      <div style="height:80px"></div>
      <div id="att-actions" style="position:fixed;bottom:calc(var(--nav-h)+0px);left:0;right:0;padding:10px 16px;background:var(--glass-bg);backdrop-filter:var(--glass-blur);border-top:1px solid var(--glass-border);max-width:var(--max-w);margin:0 auto;display:flex;gap:10px;z-index:80">
        ${!_state.isFinalized ? `
          <button class="btn btn-primary btn-full" id="att-finalize-btn" ${!_state.employees.length ? 'disabled' : ''}>
            ${_state.existingRecord ? '💾 Update Attendance' : '✅ Submit Attendance'}
          </button>
        ` : `
          <button class="btn btn-secondary btn-full" id="att-reopen-btn">✏️ Edit Attendance</button>
          <button class="btn btn-primary" id="att-share-btn">📤 Share</button>
        `}
      </div>
    `;
  }

  /* -------- Events -------- */

  function setupEvents() {
    // Date change
    document.getElementById('att-date').addEventListener('change', async (e) => {
      _state.date = e.target.value;
      await _reloadRecord();
    });

    // Shift change
    document.getElementById('att-shift').addEventListener('change', async (e) => {
      _state.shift = e.target.value;
      await _reloadRecord();
    });

    // Section filter
    document.getElementById('att-sec-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.sec-tab');
      if (!btn) return;
      _state.filterSec = btn.dataset.sec;
      document.querySelectorAll('#att-sec-tabs .sec-tab').forEach(b => b.classList.toggle('active', b === btn));
      renderEmployeeList();
    });

    // Finalize / Update button
    const finalizeBtn = document.getElementById('att-finalize-btn');
    if (finalizeBtn) {
      finalizeBtn.addEventListener('click', () => {
        const presentCount = _state.presentIds.size;
        const totalCount   = _state.employees.length;
        App.confirm(
          `Submit attendance?\n\n✅ Present: ${presentCount}\n❌ Absent: ${totalCount - presentCount}\n📅 ${fmtDateDisplay(_state.date)} · ${_state.shift} Shift`,
          finalizeAttendance
        );
      });
    }

    // Reopen
    const reopenBtn = document.getElementById('att-reopen-btn');
    if (reopenBtn) {
      reopenBtn.addEventListener('click', async () => {
        _state.isFinalized = false;
        await DB.attendance.save({ ..._state.existingRecord, isFinalized: false });
        render();
      });
    }

    // Share button
    const shareBtn = document.getElementById('att-share-btn');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        Reports.generateAndShare(_state.existingRecord);
      });
    }

    // Search
    if (!_state.isFinalized) {
      setupSearch();
    }

    updateStatusBar();
  }

  function setupSearch() {
    const searchEl   = document.getElementById('att-search');
    const dropdownEl = document.getElementById('att-dropdown');
    if (!searchEl) return;

    // Click-away to close dropdown (use once:true to avoid listener accumulation)
    function _hideDropdownOnClickAway(e) {
      if (!e.target.closest('#att-search') && !e.target.closest('#att-dropdown')) {
        dropdownEl.style.display = 'none';
      } else {
        // Re-attach if user clicked inside — wait for next outside click
        document.addEventListener('click', _hideDropdownOnClickAway, { once: true, capture: true });
      }
    }

    searchEl.addEventListener('input', () => {
      const q = searchEl.value.toLowerCase().trim();
      if (!q) { dropdownEl.style.display = 'none'; return; }

      const matches = _state.employees.filter(emp =>
        !_state.presentIds.has(emp.id) &&
        (emp.name.toLowerCase().includes(q) || (emp.employeeId||'').toLowerCase().includes(q))
      ).slice(0, 8);

      if (!matches.length) {
        dropdownEl.innerHTML = '<div style="padding:14px 16px;color:var(--text-muted);font-size:13px;">No matching employees</div>';
        dropdownEl.style.display = 'block';
        return;
      }

      dropdownEl.innerHTML = matches.map(emp => `
        <div class="att-dd-item" data-id="${emp.id}">
          <div class="emp-avatar" style="width:32px;height:32px;font-size:12px;">${initials(emp.name)}</div>
          <div>
            <div class="dd-name">${esc(emp.name)}</div>
            <div class="dd-meta">${[emp.designation, emp.section].filter(Boolean).map(esc).join(' · ')}</div>
          </div>
        </div>
      `).join('');
      dropdownEl.style.display = 'block';
      // Attach click-away listener only when dropdown is visible
      setTimeout(() => document.addEventListener('click', _hideDropdownOnClickAway, { once: true, capture: true }), 0);
    });

    dropdownEl.addEventListener('click', (e) => {
      const item = e.target.closest('.att-dd-item');
      if (!item) return;
      markPresent(item.dataset.id);
      searchEl.value = '';
      dropdownEl.style.display = 'none';
      searchEl.focus();
    });

    // Click-away to close dropdown
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#att-search') && !e.target.closest('#att-dropdown')) {
        dropdownEl.style.display = 'none';
      }
    }, { once: false });
  }

  /* -------- Mark Present / Absent -------- */

  function markPresent(empId) {
    _state.presentIds.add(empId);
    autoSave();
    refreshCounter();
    refreshPresentChips();
    renderEmployeeList();
    updateSectionTabs();
    updateStatusBar();
    updateFinalizeBtn();
  }

  function unmarkPresent(empId) {
    _state.presentIds.delete(empId);
    autoSave();
    refreshCounter();
    refreshPresentChips();
    renderEmployeeList();
    updateSectionTabs();
    updateStatusBar();
  }

  /* -------- Refresh UI Parts -------- */

  function refreshCounter() {
    const p = _state.presentIds.size;
    const a = _state.employees.length - p;
    const cntP = document.getElementById('cnt-present');
    const cntA = document.getElementById('cnt-absent');
    if (cntP) cntP.textContent = p;
    if (cntA) cntA.textContent = a;
  }

  function refreshPresentChips() {
    const wrap = document.getElementById('present-chips');
    if (!wrap) return;

    const presentEmps = _state.employees.filter(e => _state.presentIds.has(e.id)).sort((a,b) => a.name.localeCompare(b.name));
    if (!presentEmps.length) {
      wrap.innerHTML = '<span style="font-size:13px;color:var(--text-muted);">No one marked present yet</span>';
      return;
    }

    wrap.innerHTML = presentEmps.map(emp => `
      <span class="p-chip">
        ${esc(emp.name.split(' ')[0])}
        <span class="remove-chip" data-id="${emp.id}">✕</span>
      </span>
    `).join('');

    // Remove chip handlers
    wrap.querySelectorAll('.remove-chip').forEach(btn => {
      btn.addEventListener('click', () => unmarkPresent(btn.dataset.id));
    });
  }

  function renderDesigBadge(desig) {
    if (!desig) return '';
    const dLower = desig.toLowerCase().trim();
    let cls = 'desig-default';
    if (dLower.includes('foreman') || dLower.includes('foremen')) cls = 'desig-foreman';
    else if (dLower.includes('main fitter')) cls = 'desig-main-fitter';
    return `<span class="badge-desig ${cls}">${esc(desig)}</span>`;
  }

  function renderEmployeeList() {
    const listEl = document.getElementById('att-emp-list');
    if (!listEl) return;

    const filtered = _state.employees.filter(emp => {
      const desig = (emp.designation || '').toLowerCase().trim();
      const isForeman = desig.includes('foreman') || desig.includes('foremen');

      if (_state.filterSec === 'all') return true;
      if (_state.filterSec === '__foremen__') return isForeman;

      // Section selected: match section AND exclude Foremen
      return emp.section === _state.filterSec && !isForeman;
    }).sort((a,b) => a.name.localeCompare(b.name));

    if (!filtered.length) {
      listEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">No employees in this section</div>';
      return;
    }

    listEl.innerHTML = filtered.map(emp => {
      const isPresent = _state.presentIds.has(emp.id);
      const desigBadge = renderDesigBadge(emp.designation);
      const secText = emp.section ? `<span style="opacity:0.8;">${esc(emp.section)}</span>` : '';
      const subInfo = [desigBadge, secText].filter(Boolean).join(' · ');

      return `
        <div class="emp-row ${isPresent ? 'present' : ''}" data-id="${emp.id}">
          <div class="row-left">
            <div class="row-name">${esc(emp.name)}</div>
            <div class="row-sec">${subInfo}</div>
          </div>
          <div class="row-status ${isPresent ? 'p' : 'a'}">${isPresent ? '✅ P' : '○ A'}</div>
        </div>
      `;
    }).join('');

    if (!_state.isFinalized) {
      listEl.querySelectorAll('.emp-row').forEach(row => {
        row.addEventListener('click', () => {
          const id = row.dataset.id;
          if (_state.presentIds.has(id)) unmarkPresent(id);
          else markPresent(id);
        });
      });
    }
  }

  function updateStatusBar() {
    const wrap = document.getElementById('att-status-wrap');
    if (!wrap) return;
    if (_state.isFinalized) {
      wrap.innerHTML = `<div class="att-status-bar finalized mb-12"><span>✅</span><span style="font-size:13px;font-weight:600;color:var(--success)">Attendance finalized</span><span style="font-size:12px;color:var(--text-secondary);margin-left:auto">${fmtDateDisplay(_state.date)} · ${_state.shift}</span></div>`;
    } else if (_state.existingRecord) {
      wrap.innerHTML = `<div class="att-status-bar in-progress mb-12"><span>⏳</span><span style="font-size:13px;font-weight:600;color:var(--warning)">Draft — not submitted</span></div>`;
    } else {
      wrap.innerHTML = '';
    }
  }

  function updateFinalizeBtn() {
    const btn = document.getElementById('att-finalize-btn');
    if (btn) btn.disabled = !_state.employees.length;
  }

  /* -------- Auto-save draft -------- */

  let _saveTimer = null;
  function autoSave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
      await _buildAndSave(false);
    }, 500);
  }

  /* -------- Finalize -------- */

  async function finalizeAttendance() {
    const rec = await _buildAndSave(true);
    _state.existingRecord = rec;
    _state.isFinalized    = true;
    App.toast('✅ Attendance submitted!', 'success');

    // Auto-sync to Google Drive if connected and preference is on
    if (Drive.isConnected()) {
      const autoSync = await DB.settings.get('drive_autosync');
      if (autoSync !== false && autoSync !== 'false') {
        Drive.syncAttendance(rec).then(ok => {
          if (ok) App.toast('☁️ Synced to Google Drive', 'success', 2000);
          else    App.toast('⚠️ Drive sync failed — tap ☁️ to retry', 'warning', 3000);
        });
      }
    }

    // Auto-push to Firebase if configured and preference is on
    if (Firebase.isConfigured()) {
      const autoPush = await DB.settings.get('firebase_autopush');
      if (autoPush !== false && autoPush !== 'false') {
        Firebase.pushAttendance(rec).then(ok => {
          if (ok) App.toast('🔥 Pushed to Firebase', 'success', 2000);
          else    App.toast('⚠️ Firebase push failed', 'warning', 3000);
        });
      }
    }

    render(); // refresh to show finalized view
  }

  async function _buildAndSave(finalize) {
    const records = _state.employees.map(emp => ({
      empId:       emp.id,
      name:        emp.name,
      designation: emp.designation,
      section:     emp.section,
      employeeId:  emp.employeeId,
      status:      _state.presentIds.has(emp.id) ? 'present' : 'absent'
    }));

    return await DB.attendance.save({
      date:        _state.date,
      shift:       _state.shift,
      company:     _state.company,
      records,
      isFinalized: finalize
    });
  }

  /* -------- Reload when date/shift changes -------- */

  async function _reloadRecord() {
    _state.existingRecord = await DB.attendance.getByKey(_state.date, _state.shift, _state.company);
    _state.presentIds = new Set();
    _state.isFinalized = false;

    if (_state.existingRecord) {
      _state.isFinalized = _state.existingRecord.isFinalized;
      _state.existingRecord.records
        .filter(r => r.status === 'present')
        .forEach(r => _state.presentIds.add(r.empId));
    }

    // Partial re-render: rebuild screen content but preserve date/shift
    // We must preserve state before calling getHTML() which reads _state
    const screen = document.getElementById('screen-attendance');
    if (!screen) return;
    screen.innerHTML = getHTML();
    setupEvents();
    refreshCounter();
    renderEmployeeList();
    refreshPresentChips();
    updateStatusBar();
  }

  /* -------- Helpers -------- */

  function toYMD(d) {
    return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
  }

  function fmtDateDisplay(ymd) {
    if (!ymd) return '';
    const [y,m,d] = ymd.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${d} ${months[parseInt(m)-1]} ${y}`;
  }

  function initials(name) {
    return (name || '?').split(' ').slice(0,2).map(w => w[0]||'').join('').toUpperCase() || '?';
  }

  function esc(str) {
    return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { render };
})();
