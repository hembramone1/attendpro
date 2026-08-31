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
      case 'jobs':       Jobs.render(); break;
      case 'reports':    Reports.render(); break;
      case 'settings':   Settings.render(); break;
    }
    setTimeout(() => {
      attachVoiceToInputs(document.getElementById(`screen-${screenName}`));
    }, 80);
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

    // Automatically attach voice input to all text inputs & textareas inside modal
    setTimeout(() => {
      attachVoiceToInputs(overlay.querySelector('#modal-content') || overlay);
      overlay.querySelector('input,select')?.focus();
    }, 50);
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

    const [allEmps, allAtt, allJobs] = await Promise.all([
      DB.employees.getAll(),
      DB.attendance.getAll(),
      DB.jobs.getAll()
    ]);

    // Today's records (all shifts)
    const todayRecs = allAtt.filter(r => r.date === today);
    const presentToday = new Set();
    todayRecs.forEach(r => r.records.filter(x => x.status === 'present').forEach(x => presentToday.add(x.empId)));

    const totalPresent = presentToday.size;
    const totalEmps    = allEmps.length;
    const totalAbsent  = totalEmps - totalPresent;

    // Active Jobs & Manpower Engagement
    const activeJobs = allJobs.filter(j => j.status === 'active');
    const engagedEmpMap = new Map(); // empId -> jobTitle
    activeJobs.forEach(j => {
      (j.assignedEmps || []).forEach(e => {
        const empId = typeof e === 'string' ? e : e.empId;
        if (empId && (presentToday.size === 0 || presentToday.has(empId))) {
          engagedEmpMap.set(empId, j.title);
        }
      });
    });

    // Foremen are supervisors, not worker manpower. Exclude Foremen from worker manpower pool.
    const foremanEmpIds = new Set(
      allEmps
        .filter(e => {
          const desig = (e.designation || '').toLowerCase().trim();
          return desig.includes('foreman') || desig.includes('foremen');
        })
        .map(e => e.id)
    );
    const presentWorkerCount = [...presentToday].filter(id => !foremanEmpIds.has(id)).length;
    const engagedCount = engagedEmpMap.size;
    const freeCount    = Math.max(0, presentWorkerCount - engagedCount);

    // Section names
    const sectionNames = [...new Set(allEmps.map(e => e.section || 'Unassigned'))].sort((a,b) => a.localeCompare(b));

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

    // Completed Jobs
    const completedJobs = allJobs.filter(j => j.status === 'completed').sort((a,b) => (b.endTime||0) - (a.endTime||0));

    // Ongoing jobs HTML list
    const ongoingJobsHTML = activeJobs.length ? activeJobs.map(job => {
      const elapsed = formatDuration(Date.now() - job.startTime);
      const empsHTML = (job.assignedEmps || []).slice(0, 4).map(e => `
        <span class="p-chip" style="font-size:10px;padding:2px 6px">👤 ${esc(e.name)}</span>
      `).join('') + ((job.assignedEmps || []).length > 4 ? `<span class="p-chip" style="font-size:10px;padding:2px 6px">+${job.assignedEmps.length - 4} more</span>` : '');

      return `
        <div class="card mb-8" style="border-left:4px solid var(--accent);padding:12px 14px">
          <div class="flex items-center justify-between mb-4">
            <div>
              <span class="chip chip-accent" style="font-size:10px;padding:1px 6px">${esc(job.section)}</span>
              <div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-top:2px">${esc(job.title)}</div>
            </div>
            <div class="chip chip-warning" id="dash-job-timer-${job.id}" style="font-family:monospace;font-size:11px">
              ⏱️ ${elapsed}
            </div>
          </div>
          <div class="flex flex-wrap gap-8" style="margin-top:8px">${empsHTML}</div>
        </div>
      `;
    }).join('') : `
      <div class="card mb-12 text-center" style="padding:16px">
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">No ongoing jobs right now</div>
        <button class="btn btn-sm btn-outline" id="dash-create-first-job-btn">+ Start New Job</button>
      </div>
    `;

    // Completed jobs HTML list
    const completedJobsHTML = completedJobs.length ? completedJobs.slice(0, 4).map(job => {
      const duration = formatDuration(job.durationMs || ((job.endTime||Date.now()) - job.startTime));
      const empsHTML = (job.assignedEmps || []).slice(0, 4).map(e => `
        <span class="p-chip" style="font-size:10px;padding:2px 6px;background:var(--bg-elevated);border-color:var(--border-bright);color:var(--text-primary)">👤 ${esc(e.name)}</span>
      `).join('') + ((job.assignedEmps || []).length > 4 ? `<span class="p-chip" style="font-size:10px;padding:2px 6px">+${job.assignedEmps.length - 4} more</span>` : '');

      return `
        <div class="card mb-8" style="padding:12px 14px">
          <div class="flex items-center justify-between mb-4">
            <div>
              <span class="chip chip-default" style="font-size:10px;padding:1px 6px">${esc(job.section)}</span>
              <div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-top:2px">${esc(job.title)}</div>
            </div>
            <div class="chip chip-success" style="font-size:11px">
              ⏱️ Took ${duration}
            </div>
          </div>
          ${job.completionNotes ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:4px"><strong>Done:</strong> ${esc(job.completionNotes)}</div>` : ''}
          <div class="flex flex-wrap gap-8" style="margin-top:8px">${empsHTML}</div>
        </div>
      `;
    }).join('') : `
      <div class="card mb-12 text-center" style="padding:16px">
        <div style="font-size:13px;color:var(--text-secondary)">No completed jobs yet</div>
      </div>
    `;

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
          <button class="btn btn-secondary" id="dash-jobs-btn">🛠️ Manage Jobs</button>
        </div>
      </div>

      <!-- Combined Interactive Stats Grid -->
      <div class="stats-grid" style="grid-template-columns:repeat(3, 1fr)">
        <div class="stat-card success card-hover" id="stat-card-attendance" title="Click for section-wise attendance breakdown">
          <div class="stat-icon">📋</div>
          <div class="stat-value" style="font-size:24px">${totalPresent} <span style="font-size:14px;color:var(--text-secondary);font-weight:600">/ ${totalEmps}</span></div>
          <div class="stat-label">Present Status</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px">Tap details 🔍</div>
          <div class="stat-glow"></div>
        </div>

        <div class="stat-card warning card-hover" id="stat-card-engaged" style="border-color:var(--warning-border)" title="Click for section-wise engaged manpower breakdown">
          <div class="stat-icon">🛠️</div>
          <div class="stat-value" style="color:var(--warning);font-size:24px">${engagedCount}</div>
          <div class="stat-label">Engaged Manpower</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px">Tap details 🔍</div>
          <div class="stat-glow" style="background:var(--warning)"></div>
        </div>

        <div class="stat-card indigo card-hover" id="stat-card-free" title="Click for section-wise free manpower breakdown">
          <div class="stat-icon">⚡</div>
          <div class="stat-value" style="color:var(--accent);font-size:24px">${freeCount}</div>
          <div class="stat-label">Free Manpower</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px">Tap details 🔍</div>
          <div class="stat-glow"></div>
        </div>
      </div>

      <!-- Jobs Section with Ongoing / Completed Tabs -->
      <div class="flex items-center justify-between mb-8">
        <div class="section-tabs" id="dash-jobs-tab-switch" style="margin-bottom:0;padding-bottom:0">
          <button class="sec-tab active" data-dash-tab="ongoing">⚡ Ongoing (${activeJobs.length})</button>
          <button class="sec-tab" data-dash-tab="completed">📜 Completed (${completedJobs.length})</button>
        </div>
        <button class="btn-link" id="dash-view-all-jobs-btn" style="font-size:12px;color:var(--accent);border:none;background:none;cursor:pointer">View All ➔</button>
      </div>
      <div id="dash-jobs-container" class="mb-16">
        ${ongoingJobsHTML}
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

    document.getElementById('dash-take-att-btn')?.addEventListener('click', () => navigate('attendance'));
    document.getElementById('dash-jobs-btn')?.addEventListener('click', () => navigate('jobs'));
    document.getElementById('dash-view-all-jobs-btn')?.addEventListener('click', () => navigate('jobs'));
    document.getElementById('dash-create-first-job-btn')?.addEventListener('click', () => navigate('jobs'));

    // Dashboard Jobs tab switcher (Ongoing vs Completed)
    document.getElementById('dash-jobs-tab-switch')?.addEventListener('click', e => {
      const btn = e.target.closest('.sec-tab');
      if (!btn) return;
      const tab = btn.dataset.dashTab;
      document.querySelectorAll('#dash-jobs-tab-switch .sec-tab').forEach(b => b.classList.toggle('active', b === btn));
      const container = document.getElementById('dash-jobs-container');
      if (container) {
        container.innerHTML = tab === 'ongoing' ? ongoingJobsHTML : completedJobsHTML;
      }
    });

    /* -------- Card 1: Attendance Breakdown Modal -------- */
    document.getElementById('stat-card-attendance')?.addEventListener('click', () => {
      const attSectionHTML = sectionNames.map(sec => {
        const empsInSec = allEmps.filter(e => (e.section || 'Unassigned') === sec);
        const presentInSec = empsInSec.filter(e => presentToday.has(e.id));
        const absentInSec  = empsInSec.filter(e => !presentToday.has(e.id));

        return `
          <div style="margin-bottom:12px;background:var(--bg-elevated);border-radius:var(--radius-md);padding:12px">
            <div class="flex items-center justify-between mb-8">
              <div style="font-weight:800;font-size:13px;color:var(--accent)">${esc(sec)}</div>
              <div style="font-size:12px;font-weight:700">
                <span style="color:var(--success)">${presentInSec.length} Present</span> / ${empsInSec.length} Total
              </div>
            </div>
            <div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px">Present (${presentInSec.length}):</div>
            <div class="flex flex-wrap gap-8 mb-8">
              ${presentInSec.length ? presentInSec.map(e => `<span class="p-chip" style="font-size:10px">✅ ${esc(e.name)}</span>`).join('') : '<span style="font-size:11px;color:var(--text-muted)">None</span>'}
            </div>
            ${absentInSec.length ? `
              <div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px">Absent (${absentInSec.length}):</div>
              <div class="flex flex-wrap gap-8">
                ${absentInSec.map(e => `<span class="p-chip" style="font-size:10px;background:var(--danger-bg);color:var(--danger);border-color:var(--danger-border)">❌ ${esc(e.name)}</span>`).join('')}
              </div>
            ` : ''}
          </div>
        `;
      }).join('');

      modal({
        title: '📋 Attendance Breakdown',
        subtitle: `Total ${totalPresent} Present out of ${totalEmps} Manpower`,
        html: attSectionHTML || '<div style="text-align:center;padding:16px;color:var(--text-muted)">No manpower registered yet</div>'
      });
    });

    /* -------- Card 2: Engaged Manpower Breakdown Modal -------- */
    document.getElementById('stat-card-engaged')?.addEventListener('click', () => {
      const engagedSectionHTML = sectionNames.map(sec => {
        const empsInSec = allEmps.filter(e => (e.section || 'Unassigned') === sec);
        const engagedInSec = empsInSec.filter(e => engagedEmpMap.has(e.id));
        if (!engagedInSec.length) return '';

        return `
          <div style="margin-bottom:12px;background:var(--bg-elevated);border-radius:var(--radius-md);padding:12px">
            <div class="flex items-center justify-between mb-8">
              <div style="font-weight:800;font-size:13px;color:var(--warning)">${esc(sec)}</div>
              <div class="chip chip-warning" style="font-size:11px">${engagedInSec.length} Engaged</div>
            </div>
            <div class="flex flex-col gap-8">
              ${engagedInSec.map(e => `
                <div style="font-size:12px;background:var(--bg-card);padding:8px 10px;border-radius:var(--radius-sm);border:1px solid var(--border-bright);display:flex;justify-content:space-between;align-items:center">
                  <span style="font-weight:600">👤 ${esc(e.name)} <span style="font-size:10px;color:var(--text-secondary)">(${esc(e.designation||'Worker')})</span></span>
                  <span class="chip chip-accent" style="font-size:10px">🛠️ ${esc(engagedEmpMap.get(e.id))}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }).join('') || '<div style="padding:24px;text-align:center;color:var(--text-muted)">No workers currently engaged in jobs</div>';

      modal({
        title: '🛠️ Engaged Manpower Breakdown',
        subtitle: `${engagedCount} workers currently active on tasks`,
        html: engagedSectionHTML
      });
    });

    /* -------- Card 3: Free Manpower Breakdown Modal -------- */
    document.getElementById('stat-card-free')?.addEventListener('click', () => {
      const freeSectionHTML = sectionNames.map(sec => {
        const empsInSec = allEmps.filter(e => (e.section || 'Unassigned') === sec);
        const freeInSec = empsInSec.filter(e => {
          const desig = (e.designation || '').toLowerCase().trim();
          const isForeman = desig.includes('foreman') || desig.includes('foremen');
          return !isForeman && (presentToday.size === 0 || presentToday.has(e.id)) && !engagedEmpMap.has(e.id);
        });
        if (!freeInSec.length) return '';

        return `
          <div style="margin-bottom:12px;background:var(--bg-elevated);border-radius:var(--radius-md);padding:12px">
            <div class="flex items-center justify-between mb-8">
              <div style="font-weight:800;font-size:13px;color:var(--accent)">${esc(sec)}</div>
              <div class="chip chip-success" style="font-size:11px">${freeInSec.length} Free Available</div>
            </div>
            <div class="flex flex-wrap gap-8">
              ${freeInSec.map(e => `
                <span class="p-chip" style="font-size:11px;padding:4px 8px">⚡ ${esc(e.name)} <span style="opacity:0.7;font-size:10px">(${esc(e.designation||'Worker')})</span></span>
              `).join('')}
            </div>
          </div>
        `;
      }).join('') || '<div style="padding:24px;text-align:center;color:var(--text-muted)">No free manpower available right now</div>';

      modal({
        title: '⚡ Free Manpower Breakdown',
        subtitle: `${freeCount} present workers free for task assignment (excluding supervisory Foremen)`,
        html: freeSectionHTML
      });
    });
  }

  /* -------- Helpers -------- */

  function toYMD(d) {
    return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
  }

  function esc(str) {
    return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function formatDuration(ms) {
    if (!ms || ms < 0) return '0m';
    const totalSec = Math.floor(ms / 1000);
    const hrs  = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  }

  /* -------- Init -------- */

  async function init() {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
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

    // Render first screen IMMEDIATELY
    navigate(startScreen);

    // Remove splash screen immediately without artificial delays
    const splash = document.getElementById('splash-screen');
    if (splash) {
      splash.classList.add('fade-out');
      setTimeout(() => splash.remove(), 300);
    }

    // Init Drive & Firebase asynchronously in the background (non-blocking)
    Promise.all([Drive.init(), Firebase.init()]).catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', init);

  function refreshCurrentScreen() {
    _renderScreen(_currentScreen);
  }

  function getCurrentScreen() {
    return _currentScreen;
  }

  /* -------- Speech Numbers & Text Intelligence Engine -------- */
  const SMALL_NUMBERS = {
    'zero': 0, 'oh': 0, 'o': 0, 'null': 0,
    'one': 1, 'won': 1,
    'two': 2, 'to': 2, 'too': 2,
    'three': 3, 'tree': 3,
    'four': 4, 'for': 4, 'fore': 4,
    'five': 5,
    'six': 6,
    'seven': 7,
    'eight': 8, 'ate': 8,
    'nine': 9,
    'ten': 10,
    'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
    'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19,
    'twenty': 20, 'thirty': 30, 'forty': 40, 'fourty': 40, 'fifty': 50,
    'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90
  };

  function convertSpokenNumbersToDigits(text) {
    if (!text) return '';
    let str = text.trim();

    // 1. Handle multipliers: "double seven" -> "77", "triple six" -> "666"
    str = str.replace(/\b(double|doble)\s+(\w+)/gi, (match, p1, p2) => {
      const p2Low = p2.toLowerCase();
      const digit = SMALL_NUMBERS[p2Low] !== undefined ? SMALL_NUMBERS[p2Low] : (/^\d$/.test(p2) ? p2 : null);
      return digit !== null ? `${digit}${digit}` : match;
    });

    str = str.replace(/\b(triple|tripple)\s+(\w+)/gi, (match, p1, p2) => {
      const p2Low = p2.toLowerCase();
      const digit = SMALL_NUMBERS[p2Low] !== undefined ? SMALL_NUMBERS[p2Low] : (/^\d$/.test(p2) ? p2 : null);
      return digit !== null ? `${digit}${digit}${digit}` : match;
    });

    // 2. Handle composite numbers like "six hundred forty four" -> "644", "twenty five" -> "25"
    str = str.replace(/\b(one|two|three|four|five|six|seven|eight|nine)\s+hundred(\s+(and\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety))?(\s+(one|two|three|four|five|six|seven|eight|nine))?\b/gi, (match) => {
      try {
        const val = parseSpokenNumberPhrase(match);
        return val !== null ? String(val) : match;
      } catch(e) { return match; }
    });

    str = str.replace(/\b(twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety)\s+(one|two|three|four|five|six|seven|eight|nine)\b/gi, (match, tens, ones) => {
      const tVal = SMALL_NUMBERS[tens.toLowerCase()] || 0;
      const oVal = SMALL_NUMBERS[ones.toLowerCase()] || 0;
      return String(tVal + oVal);
    });

    // 3. Convert single digits in number-heavy contexts or consecutive single digit words
    // e.g. "six four four" -> "644", "one zero two" -> "102"
    const words = str.split(/\s+/);
    const convertedWords = [];
    let digitBuffer = [];

    const flushDigitBuffer = () => {
      if (digitBuffer.length > 0) {
        convertedWords.push(digitBuffer.join(''));
        digitBuffer = [];
      }
    };

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const wLow = w.toLowerCase().replace(/[.,?!]/g, '');
      const numVal = SMALL_NUMBERS[wLow];

      if (numVal !== undefined && numVal < 10) {
        digitBuffer.push(numVal);
      } else if (/^\d+$/.test(wLow)) {
        digitBuffer.push(wLow);
      } else {
        flushDigitBuffer();
        convertedWords.push(w);
      }
    }
    flushDigitBuffer();

    return convertedWords.join(' ').replace(/\s+/g, ' ').trim();
  }

  function parseSpokenNumberPhrase(phrase) {
    const tokens = phrase.toLowerCase().replace(/and/g, '').trim().split(/\s+/);
    let total = 0;
    let current = 0;
    for (const t of tokens) {
      if (t === 'hundred') {
        current = (current === 0 ? 1 : current) * 100;
      } else if (t === 'thousand') {
        total += (current === 0 ? 1 : current) * 1000;
        current = 0;
      } else if (SMALL_NUMBERS[t] !== undefined) {
        current += SMALL_NUMBERS[t];
      } else if (!isNaN(parseInt(t))) {
        current += parseInt(t);
      }
    }
    return total + current;
  }

  function parseVoiceTranscript(rawTranscript, inputEl) {
    if (!rawTranscript) return { text: '', isNumber: false, isSection: false, isName: false, category: 'text' };
    const cleaned = rawTranscript.replace(/[.,?!]+$/, '').trim();

    // Check if target input is numeric-oriented (Phone, ID, Number)
    const isExplicitNumericInput = inputEl && (
      inputEl.type === 'tel' || 
      inputEl.type === 'number' || 
      (inputEl.id && /phone|mobile|emp-id|empid|id|count|qty|hours/i.test(inputEl.id)) ||
      (inputEl.name && /phone|mobile|emp-id|empid|id|count|qty|hours/i.test(inputEl.name)) ||
      (inputEl.placeholder && /phone|mobile|id|number|#/i.test(inputEl.placeholder))
    );

    // Convert spoken numbers (e.g. "six four four" -> "644", "double seven" -> "77")
    const withDigits = convertSpokenNumbersToDigits(cleaned);

    // Check if the result is purely numeric or starts with digits
    const digitsOnly = withDigits.replace(/[^\d]/g, '');
    const isPurelyDigits = /^\d+$/.test(withDigits.replace(/\s+/g, ''));
    const hasSignificantNumbers = digitsOnly.length > 0 && (digitsOnly.length >= withDigits.replace(/[^a-zA-Z0-9]/g, '').length / 2);

    if (isExplicitNumericInput) {
      // Return clean extracted digits for numeric fields (e.g. Phone "9876543210" or ID "102")
      const resultDigits = digitsOnly || withDigits;
      return {
        text: resultDigits,
        isNumber: true,
        isSection: false,
        isName: false,
        category: 'number',
        toastMsg: `🔢 Number: "${resultDigits}"`
      };
    }

    // If whole utterance is a number (e.g. "644", "102", "777", "98765")
    if (isPurelyDigits || (digitsOnly.length >= 2 && /^(emp|id|dumper|machine|number|no|#)?\s*\d+$/i.test(withDigits))) {
      const numStr = withDigits.replace(/^(emp|id|number|no|#)\s*/i, '').trim();
      return {
        text: numStr,
        isNumber: true,
        isSection: false,
        isName: false,
        category: 'number',
        toastMsg: `🔢 Number: "${numStr}"`
      };
    }

    // Capitalize names / text titles cleanly
    let formattedText = withDigits;
    if (inputEl && (inputEl.id?.includes('name') || inputEl.placeholder?.toLowerCase().includes('name'))) {
      // Capitalize each word in name (e.g. "rajesh kumar" -> "Rajesh Kumar")
      formattedText = formattedText.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      return {
        text: formattedText,
        isNumber: false,
        isSection: false,
        isName: true,
        category: 'name',
        toastMsg: `👤 Name: "${formattedText}"`
      };
    }

    // General text (Job title, Notes, Description)
    // Capitalize first letter of sentence
    formattedText = formattedText.charAt(0).toUpperCase() + formattedText.slice(1);
    return {
      text: formattedText,
      isNumber: hasSignificantNumbers,
      isSection: false,
      isName: false,
      category: 'text',
      toastMsg: `🎙️ "${formattedText}"`
    };
  }

  /* -------- Voice Search Helper -------- */
  function initVoiceSearch(btnEl, inputEl, onResult) {
    if (!btnEl || !inputEl) return;

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      btnEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toast('Voice search is not supported in this browser. Please use Chrome, Edge or Safari.', 'warning', 3500);
      });
      return;
    }

    let recognition = null;
    let isListening = false;
    const originalPlaceholder = inputEl.placeholder || 'Search by name…';

    function stopListening() {
      if (recognition && isListening) {
        try { recognition.stop(); } catch(e) {}
      }
      isListening = false;
      btnEl.classList.remove('listening');
      btnEl.title = 'Voice Search (Speak)';
      btnEl.innerHTML = '🎙️';
      inputEl.placeholder = originalPlaceholder;
    }

    function startListening() {
      try {
        recognition = new SpeechRec();
        recognition.lang = 'en-IN';
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.maxAlternatives = 3;

        recognition.onstart = () => {
          isListening = true;
          btnEl.classList.add('listening');
          btnEl.title = 'Listening... Tap to stop';
          btnEl.innerHTML = '🔴';
          inputEl.placeholder = '🎙️ Listening... Speak now';
          toast('🎙️ Listening... Speak clearly', 'info', 2000);
        };

        recognition.onresult = (event) => {
          if (!event.results || !event.results.length) return;
          const rawTranscript = event.results[0][0].transcript.trim();

          // Parse speech intelligently into Number vs Text
          const parsed = parseVoiceTranscript(rawTranscript, inputEl);
          const finalVal = parsed.text;

          if (finalVal) {
            let handled = false;
            if (typeof onResult === 'function') {
              handled = onResult(finalVal, parsed);
            }
            if (!handled) {
              inputEl.value = finalVal;
              inputEl.dispatchEvent(new Event('input', { bubbles: true }));
              inputEl.dispatchEvent(new Event('change', { bubbles: true }));
              inputEl.focus();
              toast(parsed.toastMsg || `🎙️ "${finalVal}"`, 'success', 2200);
            }
          }
        };

        recognition.onerror = (event) => {
          if (event.error === 'no-speech') {
            toast('No speech detected. Please try again.', 'info', 2000);
          } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            toast('⚠️ Microphone permission is required for voice search.', 'warning', 3500);
          } else if (event.error !== 'aborted') {
            toast(`Voice search error: ${event.error}`, 'error', 2500);
          }
          stopListening();
        };

        recognition.onend = () => {
          stopListening();
        };

        recognition.start();
      } catch (err) {
        console.error('Speech recognition error:', err);
        stopListening();
        toast('Could not start voice search', 'error');
      }
    }

    btnEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isListening) {
        stopListening();
      } else {
        startListening();
      }
    });
  }

  /* -------- Section Matcher for Voice Search -------- */
  function matchSection(phrase, sections, employees) {
    if (!phrase) return null;
    const lower = phrase.toLowerCase().trim();

    // Check for Foremen
    if (lower.includes('foreman') || lower.includes('foremen') || lower.includes('supervisor')) {
      return { key: '__foremen__', name: 'Foremen', isForemen: true };
    }

    // Clean noise words
    const clean = lower
      .replace(/\b(section|department|dept|manpower|staff|worker|workers|people|team|group|all|show|mark|present|absent|attendance|ka|ki|ke|ko|se)\b/gi, '')
      .replace(/[^\w\s-]/g, '')
      .trim();

    // Collect all available section names from DB and employees
    const secNames = new Set([
      ...(sections || []).map(s => s && s.name).filter(Boolean),
      ...(employees || []).map(e => e && e.section).filter(Boolean)
    ]);

    // 1. Exact match with cleaned or original
    for (const name of secNames) {
      const n = name.toLowerCase().trim();
      if (n === clean || n === lower) {
        return { key: name, name: name, isForemen: false };
      }
    }

    // 2. Substring match
    if (clean.length >= 3) {
      for (const name of secNames) {
        const n = name.toLowerCase().trim();
        if (n.includes(clean) || clean.includes(n)) {
          return { key: name, name: name, isForemen: false };
        }
      }
    }

    // 3. Common industrial sections & aliases
    const aliases = {
      'office': 'Office',
      'engine': 'Engine',
      'hydraulic': 'Hydraulic',
      'hydraulics': 'Hydraulic',
      'hydrolic': 'Hydraulic',
      'transmission': 'Transmission',
      'trans': 'Transmission',
      'electrical': 'Auto Electrical',
      'electric': 'Auto Electrical',
      'electrician': 'Auto Electrical',
      'auto electric': 'Auto Electrical',
      'auto electrical': 'Auto Electrical',
      'auto electrician': 'Auto Electrical',
      'welding': 'Welding',
      'weld': 'Welding',
      'welder': 'Welding',
      'dumper': 'Dump Truck',
      'dump truck': 'Dump Truck',
      'truck': 'Dump Truck',
      'undercarriage': 'Undercarriage',
      'under carriage': 'Undercarriage',
      'tyre': 'Tyre',
      'tire': 'Tyre',
      'store': 'Store',
      'stores': 'Store',
      'maintenance': 'Maintenance',
      'general': 'General'
    };

    for (const [alias, secTarget] of Object.entries(aliases)) {
      if (clean.includes(alias) || lower.includes(alias)) {
        const realName = Array.from(secNames).find(s => s.toLowerCase() === secTarget.toLowerCase()) || secTarget;
        return { key: realName, name: realName, isForemen: false };
      }
    }

    return null;
  }

  /* -------- Attach Voice Input to Any Text/Search Inputs in a Container -------- */
  function attachVoiceToInputs(container = document) {
    if (!container) return;
    const inputs = container.querySelectorAll(
      'input[type="text"]:not([data-no-voice]), input[type="search"]:not([data-no-voice]), input[type="tel"]:not([data-no-voice]), input:not([type]):not([data-no-voice]), textarea:not([data-no-voice])'
    );

    inputs.forEach(input => {
      // Don't duplicate if already has voice button or explicitly marked
      if (input.dataset.voiceAttached === 'true') return;
      if (input.parentElement && input.parentElement.querySelector('.voice-search-btn')) return;

      const parent = input.parentElement;
      if (!parent) return;

      // If parent is a standard form-group or block, wrap input in .input-voice-wrap
      if (!parent.classList.contains('input-voice-wrap') && 
          !parent.classList.contains('search-wrap') && 
          !parent.classList.contains('att-search-wrap')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'input-voice-wrap';
        input.parentNode.insertBefore(wrapper, input);
        wrapper.appendChild(input);
      }

      const voiceBtn = document.createElement('button');
      voiceBtn.type = 'button';
      voiceBtn.className = 'voice-search-btn';
      voiceBtn.title = 'Voice Input (Speak)';
      voiceBtn.setAttribute('aria-label', 'Voice Input');
      voiceBtn.innerHTML = '🎙️';

      input.insertAdjacentElement('afterend', voiceBtn);
      input.dataset.voiceAttached = 'true';

      initVoiceSearch(voiceBtn, input);
    });
  }

  return { navigate, refreshCurrentScreen, getCurrentScreen, toast, modal, closeModal, confirm, initVoiceSearch, matchSection, attachVoiceToInputs, parseVoiceTranscript, convertSpokenNumbersToDigits };
})();
