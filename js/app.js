'use strict';

/* =============================================
   AttendPro — Main App (Router + Framework)
   ============================================= */

const App = (() => {
  let _currentScreen = 'dashboard';
  let _modalEl = null;

  /* -------- Navigation -------- */

  function navigate(screenName, force = false) {
    if (_currentScreen === screenName && !force) {
      // Re-render current screen when force is not set
      _renderScreen(screenName);
      return;
    }

    // Update screen visibility
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    const screen = document.getElementById(`screen-${screenName}`);
    const navBtn = document.querySelector(`.nav-btn[data-screen="${screenName}"]`);

    if (screen)  screen.classList.add('active');
    if (navBtn)  navBtn.classList.add('active');

    // Scroll to top
    document.getElementById('main-content').scrollTo(0, 0);

    _currentScreen = screenName;
    _renderScreen(screenName);
  }

  function _renderScreen(screenName) {
    switch (screenName) {
      case 'dashboard':  renderDashboard(); break;
      case 'manpower':   Manpower.render(); break;
      case 'attendance': Attendance.render(); break;
      case 'reports':    Reports.render(); break;
      case 'settings':   Settings.render(); break;
    }
  }

  /* -------- Toast -------- */

  function toast(message, type = 'info', duration = 3200) {
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${message}</span>`;

    const container = document.getElementById('toast-container');
    container.appendChild(el);

    setTimeout(() => {
      el.classList.add('hiding');
      setTimeout(() => el.remove(), 250);
    }, duration);
  }

  /* -------- Modal -------- */

  function modal({ title, subtitle, html, confirmText = 'Confirm', cancelText = 'Cancel', onConfirm, onDelete, showDelete = false, center = false }) {
    closeModal(); // close any open modal

    const overlay = document.createElement('div');
    overlay.className = `modal-overlay${center ? ' center' : ''}`;
    overlay.id = 'app-modal';

    const deleteBtn = showDelete ? `<button class="btn btn-danger btn-sm" id="modal-delete-btn">🗑️ Delete</button>` : '';

    overlay.innerHTML = `
      <div class="modal" role="dialog">
        <div class="modal-handle"></div>
        <div class="modal-title">${title}</div>
        ${subtitle ? `<div class="modal-sub">${subtitle}</div>` : ''}
        <div id="modal-content">${html}</div>
        <div class="modal-footer">
          ${deleteBtn}
          <button class="btn btn-ghost" id="modal-cancel-btn">${cancelText}</button>
          <button class="btn btn-primary" id="modal-confirm-btn">${confirmText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    _modalEl = overlay;

    // Click-away to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);

    document.getElementById('modal-confirm-btn').addEventListener('click', async () => {
      if (onConfirm) {
        const result = await onConfirm();
        if (result !== false) closeModal();
      } else {
        closeModal();
      }
    });

    if (showDelete && onDelete) {
      document.getElementById('modal-delete-btn').addEventListener('click', onDelete);
    }

    // Focus first input
    setTimeout(() => overlay.querySelector('input,select')?.focus(), 100);
  }

  function closeModal() {
    if (_modalEl) {
      _modalEl.remove();
      _modalEl = null;
    }
  }

  /* -------- Confirm Dialog -------- */

  function confirm(message, onConfirm) {
    modal({
      title: 'Confirm Action',
      html: `<p style="font-size:14px;color:var(--text-secondary);line-height:1.6;white-space:pre-line">${message}</p>`,
      confirmText: 'Confirm',
      center: true,
      onConfirm
    });
  }

  /* -------- Dashboard -------- */

  async function renderDashboard() {
    const screen = document.getElementById('screen-dashboard');
    const company = Settings.getCompany();
    const today   = toYMD(new Date());
    const now     = new Date();

    const [allEmps, allAtt] = await Promise.all([DB.employees.getAll(), DB.attendance.getAll()]);

    // Today's records (all shifts)
    const todayRecs = allAtt.filter(r => r.date === today);
    const presentToday = new Set();
    todayRecs.forEach(r => r.records.filter(x => x.status === 'present').forEach(x => presentToday.add(x.empId)));

    const totalPresent = presentToday.size;
    const totalEmps    = allEmps.length;
    const totalAbsent  = totalEmps - totalPresent;

    // Last 7 days attendance data
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ymd = toYMD(d);
      const dayRecs = allAtt.filter(r => r.date === ymd);
      const dayPresent = new Set();
      dayRecs.forEach(r => r.records.filter(x => x.status === 'present').forEach(x => dayPresent.add(x.empId)));
      const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      last7.push({ date: ymd, label: dayLabels[d.getDay()], present: dayPresent.size, total: totalEmps, isToday: ymd === today });
    }

    const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';
    const dateStr = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    // Today's shift status
    const shiftStatus = Settings.getShiftKeys().map(shift => {
      const rec = todayRecs.find(r => r.shift === shift);
      if (!rec) return `<div class="flex items-center justify-between" style="padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-size:13px">${shift} Shift</span><span class="chip chip-default">Not taken</span></div>`;
      const p = rec.records.filter(r => r.status === 'present').length;
      const status = rec.isFinalized ? 'chip-success' : 'chip-warning';
      const label  = rec.isFinalized ? '✅ Done' : '⏳ Draft';
      return `<div class="flex items-center justify-between" style="padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-size:13px">${shift} Shift</span><span>${p}/${rec.records.length} &nbsp;</span><span class="chip ${status}">${label}</span></div>`;
    }).join('');

    screen.innerHTML = `
      <!-- Hero -->
      <div class="hero">
        <div class="hero-greeting">${greeting} 👋</div>
        <div class="hero-company">${esc(company)}</div>
        <div class="hero-date">${dateStr}</div>
        <div class="hero-actions">
          <button class="btn btn-primary" id="dash-take-att-btn">✅ Take Attendance</button>
          <button class="btn btn-secondary" id="dash-reports-btn">📊 Reports</button>
        </div>
      </div>

      <!-- Stats -->
      <div class="stats-grid">
        <div class="stat-card accent">
          <div class="stat-icon">👥</div>
          <div class="stat-value">${totalEmps}</div>
          <div class="stat-label">Total Manpower</div>
          <div class="stat-glow"></div>
        </div>
        <div class="stat-card success">
          <div class="stat-icon">✅</div>
          <div class="stat-value">${totalPresent}</div>
          <div class="stat-label">Present Today</div>
          <div class="stat-glow"></div>
        </div>
        <div class="stat-card danger">
          <div class="stat-icon">❌</div>
          <div class="stat-value">${totalAbsent}</div>
          <div class="stat-label">Absent Today</div>
          <div class="stat-glow"></div>
        </div>
        <div class="stat-card indigo">
          <div class="stat-icon">📋</div>
          <div class="stat-value">${allAtt.length}</div>
          <div class="stat-label">Total Records</div>
          <div class="stat-glow"></div>
        </div>
      </div>

      <!-- Today's shift status -->
      <div class="sec-label">Today's Shifts</div>
      <div class="card mb-16" style="padding:4px 16px">
        ${totalEmps === 0 ? '<div style="padding:12px 0;font-size:13px;color:var(--text-muted)">Add employees first to take attendance</div>' : shiftStatus}
      </div>

      <!-- Last 7 days mini chart -->
      <div class="sec-label">Last 7 Days</div>
      <div class="card">
        <div style="display:flex;gap:6px;align-items:flex-end;justify-content:space-around;height:72px">
          ${last7.map(day => {
            const pct  = totalEmps ? Math.round((day.present / totalEmps) * 100) : 0;
            const h    = Math.max(pct, 4);
            const clr  = day.isToday ? 'var(--accent)' : pct >= 80 ? 'var(--success)' : pct > 0 ? 'var(--warning)' : 'var(--border-bright)';
            return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
              <div style="font-size:10px;color:var(--text-muted)">${day.present > 0 ? day.present : ''}</div>
              <div style="width:100%;background:${clr};border-radius:3px;height:${h}%;min-height:4px;transition:height 0.4s ease"></div>
              <div style="font-size:10px;color:${day.isToday ? 'var(--accent)' : 'var(--text-muted)'}; font-weight:${day.isToday ? '700' : '400'}">${day.label}</div>
            </div>`;
          }).join('')}
        </div>
      </div>
    `;

    document.getElementById('dash-take-att-btn').addEventListener('click', () => navigate('attendance'));
    document.getElementById('dash-reports-btn').addEventListener('click', () => navigate('reports'));
  }

  /* -------- Helpers -------- */

  function toYMD(d) {
    return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
  }

  function esc(str) {
    return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* -------- Init -------- */

  async function init() {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    // Capture install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      window._deferredInstallPrompt = e;
    });

    // Open DB
    await DB.open();

    // Load settings
    await Settings.loadAll();

    // Theme Management
    const themeModes = ['light', 'dark', 'auto'];
    // Light is default! If no theme is saved, we set it to 'light'
    let currentTheme = localStorage.getItem('theme-mode') || 'light';

    function applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      const themeBtn = document.getElementById('theme-toggle-btn');
      if (themeBtn) {
        if (theme === 'light') {
          themeBtn.textContent = '☀️';
          themeBtn.title = 'Theme: Light (Click to cycle)';
        } else if (theme === 'dark') {
          themeBtn.textContent = '🌙';
          themeBtn.title = 'Theme: Dark (Click to cycle)';
        } else {
          themeBtn.textContent = '🌓';
          themeBtn.title = 'Theme: Auto (Click to cycle)';
        }
      }
    }

    applyTheme(currentTheme);

    document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
      const nextIndex = (themeModes.indexOf(currentTheme) + 1) % themeModes.length;
      currentTheme = themeModes[nextIndex];
      localStorage.setItem('theme-mode', currentTheme);
      applyTheme(currentTheme);
      toast(`Theme set to ${currentTheme.charAt(0).toUpperCase() + currentTheme.slice(1)}`, 'success', 1500);
    });

    // Init Google Drive sync (non-blocking — reads from localStorage)
    await Drive.init();

    // Init Firebase Realtime Database sync
    await Firebase.init();

    // Setup navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => navigate(btn.dataset.screen));
    });

    // Topbar actions
    document.getElementById('topbar-excel-btn')?.addEventListener('click', () => Reports.exportExcel());
    document.getElementById('topbar-share-btn')?.addEventListener('click', async () => {
      // Quick share today's latest finalized attendance
      const all = await DB.attendance.getAll();
      const today = toYMD(new Date());
      const todayFin = all.filter(r => r.date === today && r.isFinalized);
      if (todayFin.length) {
        Reports.generateAndShare(todayFin[0]);
      } else {
        toast('No finalized attendance for today. Submit attendance first.', 'warning');
      }
    });
    document.getElementById('topbar-sync-btn')?.addEventListener('click', () => Drive.syncAll());
    document.getElementById('topbar-firebase-dot')?.addEventListener('click', () => {
      if (Firebase.isConfigured()) Firebase.syncAll();
      else navigate('settings');
    });

    // Handle URL param ?screen=
    const urlParams = new URLSearchParams(window.location.search);
    const startScreen = urlParams.get('screen') || 'dashboard';

    // Render first screen
    navigate(startScreen);
  }

  document.addEventListener('DOMContentLoaded', init);

  return { navigate, toast, modal, closeModal, confirm };
})();
