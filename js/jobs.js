'use strict';

/* =============================================
   AttendPro — Jobs & Work Assignment Module
   ============================================= */

const Jobs = (() => {
  let _activeTab = 'active'; // 'active' | 'history'
  let _sections  = [];
  let _jobs      = [];
  let _timerId   = null;

  /* -------- Render -------- */

  async function render() {
    _sections = await DB.sections.getAll();
    _jobs     = await DB.jobs.getAll();

    const screen = document.getElementById('screen-jobs');
    if (!screen) return;

    screen.innerHTML = getHTML();
    setup();

    if (_activeTab === 'active') {
      _startLiveTimers();
    } else {
      _stopLiveTimers();
    }
  }

  function getHTML() {
    const activeJobs    = _jobs.filter(j => j.status === 'active');
    const completedJobs = _jobs.filter(j => j.status === 'completed').sort((a,b) => b.endTime - a.endTime);

    return `
      <div class="flex items-center justify-between mb-8">
        <div>
          <div class="screen-title">🛠️ Jobs & Work</div>
          <div class="screen-sub">Assign tasks to present manpower</div>
        </div>
        <button class="btn btn-primary" id="jobs-create-btn">+ Create Job</button>
      </div>

      <!-- Segmented Tabs -->
      <div class="section-tabs mb-14" id="jobs-segment-tabs">
        <button class="sec-tab ${_activeTab === 'active' ? 'active' : ''}" data-tab="active">
          ⚡ Active Jobs (${activeJobs.length})
        </button>
        <button class="sec-tab ${_activeTab === 'history' ? 'active' : ''}" data-tab="history">
          📜 History (${completedJobs.length})
        </button>
      </div>

      <!-- Main Content Area -->
      <div id="jobs-content-list">
        ${_activeTab === 'active' ? renderActiveJobs(activeJobs) : renderCompletedJobs(completedJobs)}
      </div>
    `;
  }

  /* -------- Active Jobs Render -------- */

  function renderActiveJobs(list) {
    if (!list.length) {
      return `
        <div class="empty-state">
          <div class="empty-icon">🛠️</div>
          <div class="empty-title">No Active Jobs</div>
          <div class="empty-desc">Create a new job to assign present free manpower.</div>
          <button class="btn btn-primary" id="jobs-empty-create-btn">+ Create First Job</button>
        </div>
      `;
    }

    return list.map(job => {
      const elapsed = formatDuration(Date.now() - job.startTime);
      const empsHTML = job.assignedEmps.map(e => `
        <span class="p-chip" style="font-size:11px;padding:3px 8px">
          👤 ${escHtml(e.name)} <span style="opacity:0.75;font-size:10px">(${escHtml(e.section || 'General')})</span>
        </span>
      `).join('');

      return `
        <div class="card mb-12" style="border-left:4px solid var(--accent)">
          <div class="flex items-center justify-between mb-8">
            <div>
              <span class="chip chip-accent" style="margin-bottom:4px">${escHtml(job.section)}</span>
              <div style="font-size:16px;font-weight:800;color:var(--text-primary)">${escHtml(job.title)}</div>
            </div>
            <div class="chip chip-warning" id="timer-${job.id}" style="font-family:monospace;font-size:12px">
              ⏱️ ${elapsed}
            </div>
          </div>

          ${job.description ? `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;line-height:1.5">${escHtml(job.description)}</div>` : ''}

          <div style="margin-bottom:14px">
            <div class="sec-label" style="font-size:10px;margin-bottom:6px">Assigned Manpower (${job.assignedEmps.length})</div>
            <div class="flex flex-wrap gap-8">${empsHTML}</div>
          </div>

          <div class="flex items-center justify-between" style="border-top:1px solid var(--border);padding-top:12px;margin-top:8px">
            <span style="font-size:11px;color:var(--text-muted)">Started ${formatTime(job.startTime)}</span>
            <div class="flex gap-8">
              <button class="btn btn-sm btn-danger" data-cancel-job="${job.id}">Cancel</button>
              <button class="btn btn-sm btn-success" data-complete-job="${job.id}">✅ Complete Job</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  /* -------- Completed Jobs History Render -------- */

  function renderCompletedJobs(list) {
    if (!list.length) {
      return `
        <div class="empty-state">
          <div class="empty-icon">📜</div>
          <div class="empty-title">No Completed Jobs</div>
          <div class="empty-desc">Completed job records and manpower work details will appear here.</div>
        </div>
      `;
    }

    return list.map(job => {
      const duration = formatDuration(job.durationMs || (job.endTime - job.startTime));
      const empsHTML = job.assignedEmps.map(e => `
        <span class="p-chip" style="font-size:11px;padding:3px 8px;background:var(--bg-elevated);border-color:var(--border-bright);color:var(--text-primary)">
          👤 ${escHtml(e.name)} (${escHtml(e.section || 'General')})
        </span>
      `).join('');

      return `
        <div class="card mb-12">
          <div class="flex items-center justify-between mb-8">
            <div>
              <span class="chip chip-default" style="margin-bottom:4px">${escHtml(job.section)}</span>
              <div style="font-size:16px;font-weight:800;color:var(--text-primary)">${escHtml(job.title)}</div>
            </div>
            <div class="chip chip-success" style="font-size:12px">
              ⏱️ Took ${duration}
            </div>
          </div>

          ${job.description ? `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px"><strong>Task:</strong> ${escHtml(job.description)}</div>` : ''}

          ${job.completionNotes ? `
            <div style="font-size:12px;background:var(--success-bg);border:1px solid var(--success-border);padding:8px 12px;border-radius:var(--radius-sm);margin-bottom:12px;color:var(--text-primary)">
              <strong>💡 Work Done:</strong> ${escHtml(job.completionNotes)}
            </div>
          ` : ''}

          <div style="margin-bottom:12px">
            <div class="sec-label" style="font-size:10px;margin-bottom:6px">Manpower Who Worked (${job.assignedEmps.length})</div>
            <div class="flex flex-wrap gap-8">${empsHTML}</div>
          </div>

          <div class="flex items-center justify-between" style="border-top:1px solid var(--border);padding-top:10px;font-size:11px;color:var(--text-muted)">
            <span>📅 ${formatDate(job.startTime)} · ${formatTime(job.startTime)} ➔ ${formatTime(job.endTime)}</span>
            <button class="btn-link" style="color:var(--danger);font-size:11px;border:none;background:none;cursor:pointer" data-delete-job="${job.id}">Delete Record</button>
          </div>
        </div>
      `;
    }).join('');
  }

  /* -------- Setup Event Listeners -------- */

  function setup() {
    document.getElementById('jobs-create-btn')?.addEventListener('click', showCreateModal);
    document.getElementById('jobs-empty-create-btn')?.addEventListener('click', showCreateModal);

    // Segment Tabs
    document.getElementById('jobs-segment-tabs')?.addEventListener('click', e => {
      const btn = e.target.closest('.sec-tab');
      if (!btn) return;
      _activeTab = btn.dataset.tab;
      render();
    });

    // Delegated actions for Complete & Cancel & Delete
    const listEl = document.getElementById('jobs-content-list');
    if (listEl) {
      listEl.addEventListener('click', async e => {
        const completeBtn = e.target.closest('[data-complete-job]');
        if (completeBtn) {
          showCompleteModal(completeBtn.dataset.completeJob);
          return;
        }

        const cancelBtn = e.target.closest('[data-cancel-job]');
        if (cancelBtn) {
          App.confirm('Cancel this job? Assigned manpower will become free.', async () => {
            await DB.jobs.delete(cancelBtn.dataset.cancelJob);
            App.toast('Job cancelled', 'info');
            render();
          });
          return;
        }

        const deleteBtn = e.target.closest('[data-delete-job]');
        if (deleteBtn) {
          App.confirm('Delete this completed job record permanently?', async () => {
            await DB.jobs.delete(deleteBtn.dataset.deleteJob);
            App.toast('Job record deleted', 'info');
            render();
          });
          return;
        }
      });
    }
  }

  /* -------- Create Job Modal -------- */

  async function showCreateModal() {
    const today = new Date().toISOString().split('T')[0];
    const [allAtt, allEmps, allJobs] = await Promise.all([
      DB.attendance.getAll(),
      DB.employees.getAll(),
      DB.jobs.getAll()
    ]);

    // Find all employees marked 'present' today across any shift
    const todayAtts = allAtt.filter(r => r.date === today);
    const presentEmpIds = new Set();
    todayAtts.forEach(att => {
      (att.records || []).forEach(r => {
        if (r.status === 'present') presentEmpIds.add(r.empId);
      });
    });

    // Find employees currently busy in ACTIVE jobs
    const busyEmpIds = new Set();
    allJobs.filter(j => j.status === 'active').forEach(j => {
      (j.assignedEmps || []).forEach(e => busyEmpIds.add(e.empId));
    });

    // Available free present employees
    // If no attendance marked today yet, fallback to all employees with a warning tag
    const presentEmps = allEmps.filter(e => presentEmpIds.has(e.id));
    const isAttendanceTaken = presentEmpIds.size > 0;
    const poolEmps = isAttendanceTaken ? presentEmps : allEmps;
    const freeEmps = poolEmps.filter(e => !busyEmpIds.has(e.id));

    const sectionOptions = _sections.map(s => `<option value="${escHtml(s.name)}">${escHtml(s.name)}</option>`).join('');

    const formHTML = `
      <div class="form-group">
        <label class="form-label">Job / Task Title <span style="color:var(--danger)">*</span></label>
        <input class="form-input" id="job-title" placeholder="e.g. Dumper #14 Brake Overhaul">
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Section</label>
          <select class="form-select" id="job-section">
            <option value="General">General / All</option>
            ${sectionOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Date</label>
          <input class="form-input" type="date" id="job-date" value="${today}">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Task Details / Description</label>
        <textarea class="form-input" id="job-desc" rows="2" placeholder="Briefly describe what needs to be done…"></textarea>
      </div>

      <div class="form-group">
        <div class="flex items-center justify-between mb-8">
          <label class="form-label" style="margin-bottom:0">Assign Free Manpower <span style="color:var(--danger)">*</span></label>
          <span style="font-size:11px;color:var(--text-secondary)">${freeEmps.length} free available</span>
        </div>

        ${!isAttendanceTaken ? `
          <div style="font-size:11px;color:var(--warning);background:var(--warning-bg);padding:6px 10px;border-radius:var(--radius-xs);margin-bottom:8px">
            ⚠️ Today's attendance is not taken yet. Showing all employees.
          </div>
        ` : ''}

        ${!freeEmps.length ? `
          <div style="font-size:12px;color:var(--danger);padding:12px;text-align:center;background:var(--danger-bg);border-radius:var(--radius-md)">
            No free present manpower available. All present workers are assigned to active jobs or marked absent.
          </div>
        ` : `
          <div style="max-height:180px;overflow-y:auto;border:1px solid var(--border-bright);border-radius:var(--radius-md);padding:8px">
            ${freeEmps.map(emp => `
              <label class="flex items-center gap-10" style="padding:6px 8px;cursor:pointer;border-bottom:1px solid var(--border)">
                <input type="checkbox" class="job-emp-checkbox" value="${emp.id}" data-name="${escHtml(emp.name)}" data-section="${escHtml(emp.section || 'General')}">
                <div>
                  <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${escHtml(emp.name)}</div>
                  <div style="font-size:11px;color:var(--text-secondary)">${escHtml(emp.designation || 'Worker')} · ${escHtml(emp.section || 'General')}</div>
                </div>
              </label>
            `).join('')}
          </div>
        `}
      </div>
    `;

    App.modal({
      title: '🛠️ Create New Job',
      subtitle: 'Assign task and free manpower',
      html: formHTML,
      confirmText: 'Start Job',
      onConfirm: async () => {
        const title   = document.getElementById('job-title').value.trim();
        const section = document.getElementById('job-section').value;
        const date    = document.getElementById('job-date').value;
        const desc    = document.getElementById('job-desc').value.trim();

        const checkboxes = document.querySelectorAll('.job-emp-checkbox:checked');
        const assignedEmps = Array.from(checkboxes).map(cb => ({
          empId: cb.value,
          name: cb.dataset.name,
          section: cb.dataset.section
        }));

        if (!title) { App.toast('Please enter job title', 'error'); return false; }
        if (!assignedEmps.length) { App.toast('Select at least one manpower', 'error'); return false; }

        try {
          await DB.jobs.add({
            title, section, date, description: desc, assignedEmps
          });
          Firebase.triggerAutoPush();
          App.toast('🛠️ Job started!', 'success');
          render();
          return true;
        } catch(e) {
          App.toast(e.message, 'error');
          return false;
        }
      }
    });
  }

  /* -------- Complete Job Modal -------- */

  async function showCompleteModal(jobId) {
    const job = await DB.jobs.get(jobId);
    if (!job) return;

    const duration = formatDuration(Date.now() - job.startTime);

    const formHTML = `
      <div style="margin-bottom:14px;background:var(--bg-elevated);padding:12px;border-radius:var(--radius-md)">
        <div style="font-size:14px;font-weight:800;color:var(--text-primary)">${escHtml(job.title)}</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">Section: ${escHtml(job.section)} · Duration: <strong>${duration}</strong></div>
      </div>

      <div class="form-group">
        <label class="form-label">Work Done / Completion Summary</label>
        <textarea class="form-input" id="job-complete-notes" rows="3" placeholder="Describe the work completed by the group (e.g. Engine oil changed, brake pads replaced, tested successfully)..."></textarea>
      </div>
    `;

    App.modal({
      title: '✅ Complete Job',
      subtitle: 'Mark task as done & free manpower',
      html: formHTML,
      confirmText: 'Finish Job',
      onConfirm: async () => {
        const notes = document.getElementById('job-complete-notes').value;
        try {
          await DB.jobs.complete(jobId, notes);
          Firebase.triggerAutoPush();
          App.toast('✅ Job completed! Manpower is now free.', 'success');
          render();
          return true;
        } catch(e) {
          App.toast(e.message, 'error');
          return false;
        }
      }
    });
  }

  /* -------- Live Timers -------- */

  function _startLiveTimers() {
    _stopLiveTimers();
    _timerId = setInterval(() => {
      const activeJobs = _jobs.filter(j => j.status === 'active');
      activeJobs.forEach(job => {
        const el = document.getElementById(`timer-${job.id}`);
        if (el) {
          el.textContent = `⏱️ ${formatDuration(Date.now() - job.startTime)}`;
        }
      });
    }, 1000);
  }

  function _stopLiveTimers() {
    if (_timerId) {
      clearInterval(_timerId);
      _timerId = null;
    }
  }

  /* -------- Formatting Helpers -------- */

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

  function formatTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  function formatDate(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { render };
})();
