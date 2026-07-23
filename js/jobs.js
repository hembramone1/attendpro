'use strict';

/* =============================================
   AttendPro — Jobs & Work Assignment Module
   ============================================= */

const Jobs = (() => {
  let _activeTab = 'active'; // 'active' | 'pending' | 'history'
  let _sections  = [];
  let _jobs      = [];
  let _timerId   = null;

  /* -------- Render -------- */

  async function render() {
    try {
      _sections = (await DB.sections.getAll()) || [];
      _jobs     = (await DB.jobs.getAll()) || [];

      const screen = document.getElementById('screen-jobs');
      if (!screen) return;

      screen.innerHTML = getHTML();
      setup();

      if (_activeTab === 'active') {
        _startLiveTimers();
      } else {
        _stopLiveTimers();
      }
    } catch(err) {
      console.error('Error rendering Jobs screen:', err);
      const screen = document.getElementById('screen-jobs');
      if (screen) {
        screen.innerHTML = `<div style="padding:30px;text-align:center;color:var(--danger)">⚠️ Error loading Jobs: ${escHtml(err.message)}</div>`;
      }
    }
  }

  function getHTML() {
    const allJobs = _jobs || [];
    const activeJobs    = allJobs.filter(j => j && j.status === 'active' && Array.isArray(j.assignedEmps) && j.assignedEmps.length > 0);
    const pendingJobs   = allJobs.filter(j => j && (j.status === 'pending' || (j.status === 'active' && (!j.assignedEmps || j.assignedEmps.length === 0))));
    const completedJobs = allJobs.filter(j => j && j.status === 'completed').sort((a,b) => (b.endTime || 0) - (a.endTime || 0));

    return `
      <div class="flex items-center justify-between mb-8">
        <div>
          <div class="screen-title">🛠️ Jobs & Work</div>
          <div class="screen-sub">Manage active work & pending job tasks</div>
        </div>
        <button class="btn btn-primary" id="jobs-create-btn">+ Create Job</button>
      </div>

      <!-- Segmented Tabs: Active | Pending | History -->
      <div class="section-tabs mb-14" id="jobs-segment-tabs">
        <button class="sec-tab ${_activeTab === 'active' ? 'active' : ''}" data-tab="active">
          ⚡ Active (${activeJobs.length})
        </button>
        <button class="sec-tab ${_activeTab === 'pending' ? 'active' : ''}" data-tab="pending">
          ⏳ Pending (${pendingJobs.length})
        </button>
        <button class="sec-tab ${_activeTab === 'history' ? 'active' : ''}" data-tab="history">
          📜 History (${completedJobs.length})
        </button>
      </div>

      <!-- Main Content Area -->
      <div id="jobs-content-list">
        ${_activeTab === 'active' ? renderActiveJobs(activeJobs) :
          _activeTab === 'pending' ? renderPendingJobs(pendingJobs) :
          renderCompletedJobs(completedJobs)}
      </div>
    `;
  }

  /* -------- Sub-Tasks & Assisting Manpower Helper -------- */

  function renderSubTasksHTML(job) {
    if (!job.subTasks || !job.subTasks.length) return '';

    return `
      <div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border)">
        <div class="sec-label" style="font-size:11px;color:var(--accent);margin-bottom:6px">
          🤝 Assistance Tasks & Specialist Support (${job.subTasks.length})
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${job.subTasks.map(st => {
            const emps = (st.assignedEmps || []).map(e => {
              const name = typeof e === 'string' ? e : (e.name || e.empId || 'Worker');
              const desig = typeof e === 'string' ? '' : (e.designation ? ` (${e.designation})` : '');
              const sec   = typeof e === 'string' ? '' : (e.section ? ` · ${e.section}` : '');
              return `<strong>${escHtml(name)}</strong>${escHtml(desig)}${escHtml(sec)}`;
            }).join(', ');

            return `
              <div style="font-size:12px;background:var(--bg-elevated);border:1px solid var(--border-bright);padding:6px 10px;border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:space-between">
                <div>
                  <span style="font-weight:700;color:var(--text-primary)">📌 ${escHtml(st.title)}</span>
                  ${emps ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:2px">Assisting: ${emps}</div>` : ''}
                </div>
                ${job.status !== 'completed' ? `
                  <button class="btn-link" style="color:var(--danger);font-size:11px;border:none;background:none;cursor:pointer;padding:2px 4px" data-delete-subtask="${job.id}:${st.id}">🗑️</button>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  /* -------- Active Jobs Render -------- */

  function renderActiveJobs(list) {
    if (!list || !list.length) {
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
      const startTime = job.startTime || job.createdAt || Date.now();
      const elapsed = formatDuration(Date.now() - startTime);
      const isPending = !job.assignedEmps || job.assignedEmps.length === 0;

      const empsHTML = isPending ? `
        <div style="font-size:12px;color:var(--text-secondary);background:var(--bg-elevated);padding:8px 12px;border-radius:var(--radius-sm);border:1px dashed var(--border);display:flex;align-items:center;justify-content:space-between">
          <span>⚠️ No manpower assigned yet</span>
          <button class="btn btn-sm btn-outline" data-assign-job="${job.id}" style="padding:3px 10px;font-size:11px">➕ Assign Manpower</button>
        </div>
      ` : `
        <div class="flex flex-wrap gap-8 items-center">
          ${(job.assignedEmps || []).map(e => {
            const name = typeof e === 'string' ? e : (e.name || e.empId || 'Worker');
            const sec  = typeof e === 'string' ? 'General' : (e.section || 'General');
            const tag  = typeof e !== 'string' && e.isAssisting ? ` <span style="font-size:9px;background:var(--accent);color:#fff;padding:1px 4px;border-radius:3px">Assisting</span>` : '';
            return `<span class="p-chip" style="font-size:11px;padding:3px 8px">
              👤 ${escHtml(name)} <span style="opacity:0.75;font-size:10px">(${escHtml(sec)})</span>${tag}
            </span>`;
          }).join('')}
          <button class="btn-link" data-assign-job="${job.id}" style="font-size:11px;margin-left:4px;border:none;background:none;color:var(--accent);cursor:pointer">✏️ Edit</button>
        </div>
      `;

      return `
        <div class="card mb-12" style="border-left:4px solid ${isPending ? 'var(--warning)' : 'var(--accent)'}">
          <div class="flex items-center justify-between mb-8">
            <div>
              <span class="chip ${isPending ? 'chip-warning' : 'chip-accent'}" style="margin-bottom:4px">
                ${isPending ? '⏳ Pending Manpower' : escHtml(job.section)}
              </span>
              <div style="font-size:16px;font-weight:800;color:var(--text-primary)">${escHtml(job.title)}</div>
            </div>
            <div class="chip chip-warning" id="timer-${job.id}" style="font-family:monospace;font-size:12px">
              ⏱️ ${elapsed}
            </div>
          </div>

          ${job.description ? `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;line-height:1.5">${escHtml(job.description)}</div>` : ''}

          <div style="margin-bottom:12px">
            <div class="sec-label" style="font-size:10px;margin-bottom:6px">Assigned Primary Manpower (${(job.assignedEmps || []).length})</div>
            ${empsHTML}
          </div>

          ${renderSubTasksHTML(job)}

          <div style="margin-top:10px">
            <button class="btn btn-sm btn-outline" data-add-assistance="${job.id}" style="width:100%;font-size:12px;border-style:dashed">
              🤝 + Add Assistance Task & Specialist Manpower (Welder, Turner, Crane, Electrician…)
            </button>
          </div>

          <div class="flex items-center justify-between" style="border-top:1px solid var(--border);padding-top:12px;margin-top:10px">
            <span style="font-size:11px;color:var(--text-muted)">Started ${formatTime(startTime)}</span>
            <div class="flex gap-8">
              <button class="btn btn-sm btn-danger" data-cancel-job="${job.id}">Cancel</button>
              <button class="btn btn-sm btn-success" data-complete-job="${job.id}">✅ Complete Job</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  /* -------- Pending Jobs Render -------- */

  function renderPendingJobs(list) {
    if (!list || !list.length) {
      return `
        <div class="empty-state">
          <div class="empty-icon">⏳</div>
          <div class="empty-title">No Pending Jobs</div>
          <div class="empty-desc">Jobs created without manpower will wait here until manpower is assigned to start them.</div>
          <button class="btn btn-primary" id="jobs-empty-create-btn">+ Create Job</button>
        </div>
      `;
    }

    return list.map(job => {
      return `
        <div class="card mb-12" style="border-left:4px solid var(--warning)">
          <div class="flex items-center justify-between mb-8">
            <div>
              <span class="chip chip-warning" style="margin-bottom:4px">⏳ Pending Start</span>
              <span class="chip chip-default" style="margin-bottom:4px">${escHtml(job.section)}</span>
              <div style="font-size:16px;font-weight:800;color:var(--text-primary)">${escHtml(job.title)}</div>
            </div>
            <div class="chip chip-default" style="font-size:11px">
              Not Started
            </div>
          </div>

          ${job.description ? `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;line-height:1.5">${escHtml(job.description)}</div>` : ''}

          <div style="margin-bottom:14px;background:var(--bg-elevated);padding:10px 12px;border-radius:var(--radius-sm);border:1px dashed var(--border);display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:12px;color:var(--text-secondary)">⚠️ Assign present manpower to start timer & move to Active Jobs</span>
            <button class="btn btn-sm btn-primary" data-assign-job="${job.id}" style="padding:6px 12px;font-size:12px;white-space:nowrap">
              ▶️ Start Job & Assign
            </button>
          </div>

          ${renderSubTasksHTML(job)}

          <div class="flex items-center justify-between" style="border-top:1px solid var(--border);padding-top:10px;font-size:11px;color:var(--text-muted)">
            <span>Created ${formatDate(job.createdAt || Date.now())}</span>
            <button class="btn-link" style="color:var(--danger);font-size:11px;border:none;background:none;cursor:pointer" data-cancel-job="${job.id}">Delete Pending Job</button>
          </div>
        </div>
      `;
    }).join('');
  }

  /* -------- Completed Jobs History Render -------- */

  function renderCompletedJobs(list) {
    if (!list || !list.length) {
      return `
        <div class="empty-state">
          <div class="empty-icon">📜</div>
          <div class="empty-title">No Completed Jobs</div>
          <div class="empty-desc">Completed job records and manpower work details will appear here.</div>
        </div>
      `;
    }

    return list.map(job => {
      const duration = formatDuration(job.durationMs || (job.endTime && job.startTime ? job.endTime - job.startTime : 0));
      const empsHTML = (job.assignedEmps || []).map(e => {
        const name = typeof e === 'string' ? e : (e.name || e.empId || 'Worker');
        const sec  = typeof e === 'string' ? 'General' : (e.section || 'General');
        const tag  = typeof e !== 'string' && e.isAssisting ? ` <span style="font-size:9px;background:var(--accent);color:#fff;padding:1px 4px;border-radius:3px">Assisting</span>` : '';
        return `<span class="p-chip" style="font-size:11px;padding:3px 8px;background:var(--bg-elevated);border-color:var(--border-bright);color:var(--text-primary)">
          👤 ${escHtml(name)} (${escHtml(sec)})${tag}
        </span>`;
      }).join('');

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
            <div class="sec-label" style="font-size:10px;margin-bottom:6px">Manpower Who Worked (${(job.assignedEmps || []).length})</div>
            <div class="flex flex-wrap gap-8">${empsHTML || '<span style="font-size:12px;color:var(--text-secondary)">No manpower assigned</span>'}</div>
          </div>

          ${renderSubTasksHTML(job)}

          <div class="flex items-center justify-between" style="border-top:1px solid var(--border);padding-top:10px;font-size:11px;color:var(--text-muted);margin-top:8px">
            <span>📅 ${formatDate(job.startTime || job.createdAt)} · ${formatTime(job.startTime || job.createdAt)} ➔ ${formatTime(job.endTime)}</span>
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

    // Delegated actions for Complete & Cancel & Delete & Assign & Assistance Sub-tasks
    const listEl = document.getElementById('jobs-content-list');
    if (listEl) {
      listEl.addEventListener('click', async e => {
        const assignBtn = e.target.closest('[data-assign-job]');
        if (assignBtn) {
          showAssignManpowerModal(assignBtn.dataset.assignJob);
          return;
        }

        const assistBtn = e.target.closest('[data-add-assistance]');
        if (assistBtn) {
          showAddAssistanceModal(assistBtn.dataset.addAssistance);
          return;
        }

        const deleteSubBtn = e.target.closest('[data-delete-subtask]');
        if (deleteSubBtn) {
          const [jId, sId] = deleteSubBtn.dataset.deleteSubtask.split(':');
          App.confirm('Remove this assistance sub-task?', async () => {
            await DB.jobs.deleteSubTask(jId, sId);
            Firebase.triggerAutoPush();
            App.toast('Assistance sub-task removed', 'info');
            render();
          });
          return;
        }

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

  /* -------- Add Assistance Task & Specialist Manpower Modal -------- */

  async function showAddAssistanceModal(jobId) {
    const job = await DB.jobs.get(jobId);
    if (!job) return;

    const today = new Date().toISOString().split('T')[0];
    const [allAtt, allEmps, allJobs] = await Promise.all([
      DB.attendance.getAll(),
      DB.employees.getAll(),
      DB.jobs.getAll()
    ]);

    const todayAtts = allAtt.filter(r => r.date === today);
    const presentEmpIds = new Set();
    todayAtts.forEach(att => {
      (att.records || []).forEach(r => {
        if (r.status === 'present') presentEmpIds.add(r.empId);
      });
    });

    const busyEmpIds = new Set();
    allJobs.filter(j => j.status === 'active' && j.id !== jobId).forEach(j => {
      (j.assignedEmps || []).forEach(e => {
        const id = typeof e === 'string' ? e : e.empId;
        if (id) busyEmpIds.add(id);
      });
    });

    const isAttendanceTaken = presentEmpIds.size > 0;
    const poolEmps = isAttendanceTaken ? allEmps.filter(e => presentEmpIds.has(e.id)) : allEmps;

    // Exclude Foremen designation from job manpower pool
    const nonForemanEmps = poolEmps.filter(e => {
      const desig = (e.designation || '').toLowerCase().trim();
      return !desig.includes('foreman') && !desig.includes('foremen');
    });

    const freeEmps = nonForemanEmps.filter(e => !busyEmpIds.has(e.id));

    const formHTML = `
      <div style="margin-bottom:12px;background:var(--bg-elevated);padding:10px 12px;border-radius:var(--radius-md)">
        <div style="font-size:14px;font-weight:800;color:var(--text-primary)">${escHtml(job.title)}</div>
        <div style="font-size:12px;color:var(--text-secondary)">Primary Section: <strong>${escHtml(job.section)}</strong></div>
      </div>

      <div class="form-group">
        <label class="form-label">Additional Task / Assistance Description <span style="color:var(--danger)">*</span></label>
        <input class="form-input" id="assistance-title" placeholder="e.g. Bracket Welding Support, Crane Lifting, Electrical Repair">
      </div>

      <div class="form-group">
        <label class="form-label" style="margin-bottom:6px">Filter Assisting Specialist Role</label>
        <div class="flex flex-wrap gap-4 mb-8" id="specialist-filter-btns">
          <button type="button" class="btn btn-xs btn-primary spec-btn" data-role="all">✨ All Free</button>
          <button type="button" class="btn btn-xs btn-outline spec-btn" data-role="welder">👨‍🏭 Welder</button>
          <button type="button" class="btn btn-xs btn-outline spec-btn" data-role="turner">🔧 Turner</button>
          <button type="button" class="btn btn-xs btn-outline spec-btn" data-role="crane">🏗️ Crane Operator</button>
          <button type="button" class="btn btn-xs btn-outline spec-btn" data-role="electrician">⚡ Auto-Electrician</button>
        </div>

        <div class="flex items-center justify-between mb-6">
          <label class="form-label" style="margin-bottom:0">Select Assisting Specialist Manpower</label>
          <span style="font-size:11px;color:var(--text-secondary)" id="assistance-count"></span>
        </div>

        <div id="assistance-manpower-container"></div>
      </div>
    `;

    App.modal({
      title: '🤝 Add Assistance & Specialist Manpower',
      subtitle: 'Engage assisting manpower from Welder, Turner, Crane, Electrician etc.',
      html: formHTML,
      confirmText: 'Engage Assisting Manpower',
      onConfirm: async () => {
        const title = document.getElementById('assistance-title').value.trim();
        if (!title) { App.toast('Please enter assistance task description', 'error'); return false; }

        const checkboxes = document.querySelectorAll('.assistance-emp-checkbox:checked');
        const assignedEmps = Array.from(checkboxes).map(cb => ({
          empId: cb.value,
          name: cb.dataset.name,
          section: cb.dataset.section,
          designation: cb.dataset.designation
        }));

        try {
          await DB.jobs.addSubTask(jobId, { title, assignedEmps });
          Firebase.triggerAutoPush();
          _activeTab = 'active';
          App.toast(`🤝 Assistance task "${title}" added with ${assignedEmps.length} assisting specialists!`, 'success');
          render();
          return true;
        } catch(e) {
          App.toast(e.message, 'error');
          return false;
        }
      }
    });

    let _selectedRole = 'all';

    function renderAssistanceList() {
      const container = document.getElementById('assistance-manpower-container');
      const countEl   = document.getElementById('assistance-count');
      if (!container) return;

      let filtered = freeEmps;
      if (_selectedRole === 'welder') {
        filtered = freeEmps.filter(e => (e.designation || '').toLowerCase().includes('welder'));
      } else if (_selectedRole === 'turner') {
        filtered = freeEmps.filter(e => (e.designation || '').toLowerCase().includes('turner'));
      } else if (_selectedRole === 'crane') {
        filtered = freeEmps.filter(e => (e.designation || '').toLowerCase().includes('crane') || (e.designation || '').toLowerCase().includes('operator'));
      } else if (_selectedRole === 'electrician') {
        filtered = freeEmps.filter(e => (e.designation || '').toLowerCase().includes('electrician') || (e.designation || '').toLowerCase().includes('auto-electr'));
      }

      if (countEl) {
        countEl.textContent = `${filtered.length} present & free available`;
      }

      if (!filtered.length) {
        container.innerHTML = `
          <div style="font-size:12px;color:var(--text-secondary);padding:14px;text-align:center;background:var(--bg-elevated);border-radius:var(--radius-md);border:1px dashed var(--border)">
            No present free manpower matching this specialist filter.
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div style="max-height:200px;overflow-y:auto;border:1px solid var(--border-bright);border-radius:var(--radius-md);padding:8px">
          ${filtered.map(emp => {
            const desig = (emp.designation || '').toLowerCase();
            let icon = '👤';
            if (desig.includes('welder')) icon = '👨‍🏭';
            else if (desig.includes('turner')) icon = '🔧';
            else if (desig.includes('crane')) icon = '🏗️';
            else if (desig.includes('electrician')) icon = '⚡';

            return `
              <label class="flex items-center gap-10" style="padding:6px 8px;cursor:pointer;border-bottom:1px solid var(--border)">
                <input type="checkbox" class="assistance-emp-checkbox" value="${emp.id}" data-name="${escHtml(emp.name)}" data-section="${escHtml(emp.section || 'General')}" data-designation="${escHtml(emp.designation || 'Worker')}">
                <div>
                  <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${icon} ${escHtml(emp.name)}</div>
                  <div style="font-size:11px;color:var(--text-secondary)">${escHtml(emp.designation || 'Worker')} · ${escHtml(emp.section || 'General')}</div>
                </div>
              </label>
            `;
          }).join('')}
        </div>
      `;
    }

    setTimeout(() => {
      renderAssistanceList();

      document.getElementById('specialist-filter-btns')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.spec-btn');
        if (!btn) return;
        _selectedRole = btn.dataset.role;
        document.querySelectorAll('#specialist-filter-btns .spec-btn').forEach(b => {
          b.classList.toggle('btn-primary', b === btn);
          b.classList.toggle('btn-outline', b !== btn);
        });
        renderAssistanceList();
      });
    }, 100);
  }

  /* -------- Create Job Modal -------- */

  async function showCreateModal() {
    const today = new Date().toISOString().split('T')[0];
    const [allAtt, allEmps, allJobs] = await Promise.all([
      DB.attendance.getAll(),
      DB.employees.getAll(),
      DB.jobs.getAll()
    ]);

    const todayAtts = allAtt.filter(r => r.date === today);
    const presentEmpIds = new Set();
    todayAtts.forEach(att => {
      (att.records || []).forEach(r => {
        if (r.status === 'present') presentEmpIds.add(r.empId);
      });
    });

    const busyEmpIds = new Set();
    allJobs.filter(j => j.status === 'active').forEach(j => {
      (j.assignedEmps || []).forEach(e => {
        const id = typeof e === 'string' ? e : e.empId;
        if (id) busyEmpIds.add(id);
      });
    });

    const presentEmps = allEmps.filter(e => presentEmpIds.has(e.id));
    const isAttendanceTaken = presentEmpIds.size > 0;
    const poolEmps = isAttendanceTaken ? presentEmps : allEmps;
    
    // Exclude Foremen designation from job manpower pool
    const nonForemanEmps = poolEmps.filter(e => {
      const desig = (e.designation || '').toLowerCase().trim();
      return !desig.includes('foreman') && !desig.includes('foremen');
    });
    
    const freeEmps = nonForemanEmps.filter(e => !busyEmpIds.has(e.id));

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
            <option value="General">General / All Sections</option>
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
          <label class="form-label" style="margin-bottom:0">Assign Free Manpower <span style="font-weight:400;color:var(--text-secondary)">(Optional)</span></label>
          <span style="font-size:11px;color:var(--text-secondary)" id="job-free-count"></span>
        </div>

        ${!isAttendanceTaken ? `
          <div style="font-size:11px;color:var(--warning);background:var(--warning-bg);padding:6px 10px;border-radius:var(--radius-xs);margin-bottom:8px">
            ⚠️ Today's attendance is not taken yet. Showing all employees.
          </div>
        ` : ''}

        <div id="job-manpower-container">
          <!-- Filtered section free manpower checkbox list -->
        </div>
      </div>
    `;

    App.modal({
      title: '🛠️ Create New Job',
      subtitle: 'Assign task and free manpower (optional)',
      html: formHTML,
      confirmText: 'Create Job',
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

        try {
          await DB.jobs.add({
            title, section, date, description: desc, assignedEmps
          });
          Firebase.triggerAutoPush();
          if (assignedEmps.length > 0) {
            App.toast('🛠️ Job started with assigned manpower!', 'success');
          } else {
            App.toast('⏳ Job created as Pending Manpower', 'info');
          }
          render();
          return true;
        } catch(e) {
          App.toast(e.message, 'error');
          return false;
        }
      }
    });

    // Dynamically filter manpower checkbox list strictly by selected section (excluding Foremen)
    function renderManpowerList(selectedSection, showAllSections = false) {
      const container = document.getElementById('job-manpower-container');
      const countEl   = document.getElementById('job-free-count');
      if (!container) return;

      let filteredEmps = freeEmps;
      const isSpecificSection = selectedSection && selectedSection !== 'General';

      if (isSpecificSection && !showAllSections) {
        filteredEmps = freeEmps.filter(e => (e.section || '').trim() === selectedSection.trim());
      }

      if (countEl) {
        countEl.innerHTML = isSpecificSection ? `
          <span style="color:var(--accent);font-weight:600">${filteredEmps.length} present & free in ${escHtml(selectedSection)}</span>
          <a href="#" id="toggle-all-sec" style="font-size:11px;margin-left:6px;color:var(--text-secondary)">(${showAllSections ? 'Show ' + escHtml(selectedSection) + ' only' : 'Show all sections'})</a>
        ` : `${filteredEmps.length} free available`;
      }

      document.getElementById('toggle-all-sec')?.addEventListener('click', (ev) => {
        ev.preventDefault();
        renderManpowerList(selectedSection, !showAllSections);
      });

      if (!filteredEmps.length) {
        container.innerHTML = `
          <div style="font-size:12px;color:var(--text-secondary);padding:12px;text-align:center;background:var(--bg-elevated);border-radius:var(--radius-md);border:1px dashed var(--border)">
            No present free manpower in <strong>${escHtml(selectedSection)}</strong>.
            <div style="margin-top:6px;font-size:11px">
              <a href="#" id="empty-toggle-all" style="color:var(--accent)">Click to view free manpower from other sections</a> or create the job now and assign manpower later.
            </div>
          </div>
        `;
        document.getElementById('empty-toggle-all')?.addEventListener('click', (ev) => {
          ev.preventDefault();
          renderManpowerList(selectedSection, true);
        });
        return;
      }

      container.innerHTML = `
        <div style="max-height:180px;overflow-y:auto;border:1px solid var(--border-bright);border-radius:var(--radius-md);padding:8px">
          ${filteredEmps.map(emp => `
            <label class="flex items-center gap-10" style="padding:6px 8px;cursor:pointer;border-bottom:1px solid var(--border)">
              <input type="checkbox" class="job-emp-checkbox" value="${emp.id}" data-name="${escHtml(emp.name)}" data-section="${escHtml(emp.section || 'General')}">
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${escHtml(emp.name)}</div>
                <div style="font-size:11px;color:var(--text-secondary)">${escHtml(emp.designation || 'Worker')} · ${escHtml(emp.section || 'General')}</div>
              </div>
            </label>
          `).join('')}
        </div>
      `;
    }

    // Initial render & section change listener
    setTimeout(() => {
      const sectionSel = document.getElementById('job-section');
      renderManpowerList(sectionSel?.value || 'General');
      sectionSel?.addEventListener('change', (e) => {
        renderManpowerList(e.target.value);
      });
    }, 100);
  }

  /* -------- Assign Manpower Modal -------- */

  async function showAssignManpowerModal(jobId) {
    const job = await DB.jobs.get(jobId);
    if (!job) return;

    const today = new Date().toISOString().split('T')[0];
    const [allAtt, allEmps, allJobs] = await Promise.all([
      DB.attendance.getAll(),
      DB.employees.getAll(),
      DB.jobs.getAll()
    ]);

    const todayAtts = allAtt.filter(r => r.date === today);
    const presentEmpIds = new Set();
    todayAtts.forEach(att => {
      (att.records || []).forEach(r => {
        if (r.status === 'present') presentEmpIds.add(r.empId);
      });
    });

    // Busy in OTHER active jobs
    const busyEmpIds = new Set();
    allJobs.filter(j => j.status === 'active' && j.id !== jobId).forEach(j => {
      (j.assignedEmps || []).forEach(e => {
        const id = typeof e === 'string' ? e : e.empId;
        if (id) busyEmpIds.add(id);
      });
    });

    const isAttendanceTaken = presentEmpIds.size > 0;
    const poolEmps = isAttendanceTaken ? allEmps.filter(e => presentEmpIds.has(e.id)) : allEmps;

    // Exclude Foremen designation from job manpower pool
    const nonForemanEmps = poolEmps.filter(e => {
      const desig = (e.designation || '').toLowerCase().trim();
      return !desig.includes('foreman') && !desig.includes('foremen');
    });
    
    const freeEmps = nonForemanEmps.filter(e => !busyEmpIds.has(e.id));
    const currentlyAssignedIds = new Set((job.assignedEmps || []).map(e => typeof e === 'string' ? e : e.empId));

    const isSpecificSection = job.section && job.section !== 'General';

    const formHTML = `
      <div style="margin-bottom:12px;background:var(--bg-elevated);padding:10px 12px;border-radius:var(--radius-md)">
        <div style="font-size:14px;font-weight:800;color:var(--text-primary)">${escHtml(job.title)}</div>
        <div style="font-size:12px;color:var(--text-secondary)">Section: <strong>${escHtml(job.section)}</strong></div>
      </div>

      <div class="form-group">
        <div class="flex items-center justify-between mb-8">
          <label class="form-label" style="margin-bottom:0">Select Present Free Manpower</label>
          <span style="font-size:11px;color:var(--text-secondary)" id="assign-free-count"></span>
        </div>

        <div id="assign-manpower-container"></div>
      </div>
    `;

    App.modal({
      title: '➕ Assign Manpower',
      subtitle: `Select free manpower for ${escHtml(job.title)}`,
      html: formHTML,
      confirmText: 'Save & Start Job',
      onConfirm: async () => {
        const checkboxes = document.querySelectorAll('.assign-emp-checkbox:checked');
        const assignedEmps = Array.from(checkboxes).map(cb => ({
          empId: cb.value,
          name: cb.dataset.name,
          section: cb.dataset.section
        }));

        try {
          await DB.jobs.assignManpower(jobId, assignedEmps);
          Firebase.triggerAutoPush();
          if (assignedEmps.length > 0) {
            _activeTab = 'active';
            App.toast('⚡ Job started & moved to Active Jobs!', 'success');
          } else {
            _activeTab = 'pending';
            App.toast('⏳ Job saved as Pending', 'info');
          }
          render();
          return true;
        } catch(e) {
          App.toast(e.message, 'error');
          return false;
        }
      }
    });

    function renderAssignList(showAllSections = false) {
      const container = document.getElementById('assign-manpower-container');
      const countEl   = document.getElementById('assign-free-count');
      if (!container) return;

      let filteredEmps = freeEmps;
      if (isSpecificSection && !showAllSections) {
        filteredEmps = freeEmps.filter(e =>
          (e.section || '').trim() === job.section.trim() ||
          currentlyAssignedIds.has(e.id)
        );
      }

      if (countEl) {
        countEl.innerHTML = isSpecificSection ? `
          <span style="color:var(--accent);font-weight:600">${filteredEmps.length} free in ${escHtml(job.section)}</span>
          <a href="#" id="assign-toggle-sec" style="font-size:11px;margin-left:6px;color:var(--text-secondary)">(${showAllSections ? 'Show ' + escHtml(job.section) + ' only' : 'Show all sections'})</a>
        ` : `${filteredEmps.length} free available`;
      }

      document.getElementById('assign-toggle-sec')?.addEventListener('click', (ev) => {
        ev.preventDefault();
        renderAssignList(!showAllSections);
      });

      if (!filteredEmps.length) {
        container.innerHTML = `
          <div style="font-size:12px;color:var(--text-secondary);padding:14px;text-align:center;background:var(--bg-elevated);border-radius:var(--radius-md);border:1px dashed var(--border)">
            No present free manpower in <strong>${escHtml(job.section)}</strong>.
            <div style="margin-top:6px;font-size:11px">
              <a href="#" id="assign-empty-toggle" style="color:var(--accent)">Click to view free manpower from other sections</a>.
            </div>
          </div>
        `;
        document.getElementById('assign-empty-toggle')?.addEventListener('click', (ev) => {
          ev.preventDefault();
          renderAssignList(true);
        });
        return;
      }

      container.innerHTML = `
        <div style="max-height:220px;overflow-y:auto;border:1px solid var(--border-bright);border-radius:var(--radius-md);padding:8px">
          ${filteredEmps.map(emp => {
            const isChecked = currentlyAssignedIds.has(emp.id) ? 'checked' : '';
            return `
              <label class="flex items-center gap-10" style="padding:6px 8px;cursor:pointer;border-bottom:1px solid var(--border)">
                <input type="checkbox" class="assign-emp-checkbox" value="${emp.id}" data-name="${escHtml(emp.name)}" data-section="${escHtml(emp.section || 'General')}" ${isChecked}>
                <div>
                  <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${escHtml(emp.name)}</div>
                  <div style="font-size:11px;color:var(--text-secondary)">${escHtml(emp.designation || 'Worker')} · ${escHtml(emp.section || 'General')}</div>
                </div>
              </label>
            `;
          }).join('')}
        </div>
      `;
    }

    setTimeout(() => { renderAssignList(false); }, 100);
  }

  /* -------- Complete Job Modal -------- */

  async function showCompleteModal(jobId) {
    const job = await DB.jobs.get(jobId);
    if (!job) return;

    const now = new Date();
    const defaultFinishDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const defaultFinishTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    const initialDuration = formatDuration(Date.now() - job.startTime);

    const formHTML = `
      <div style="margin-bottom:14px;background:var(--bg-elevated);padding:12px;border-radius:var(--radius-md)">
        <div style="font-size:14px;font-weight:800;color:var(--text-primary)">${escHtml(job.title)}</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">Section: ${escHtml(job.section)} · Duration: <strong id="complete-duration-preview">${initialDuration}</strong></div>
      </div>

      <div class="form-row mb-12">
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Finish Date</label>
          <input type="date" class="form-input" id="job-finish-date" value="${defaultFinishDate}">
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Finish Time</label>
          <input type="time" class="form-input" id="job-finish-time" value="${defaultFinishTime}">
        </div>
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
        const notes      = document.getElementById('job-complete-notes').value;
        const finishDate = document.getElementById('job-finish-date').value;
        const finishTime = document.getElementById('job-finish-time').value;

        let customEndTime = Date.now();
        if (finishDate && finishTime) {
          const parsed = new Date(`${finishDate}T${finishTime}`);
          if (!isNaN(parsed.getTime())) {
            customEndTime = parsed.getTime();
          }
        }

        try {
          await DB.jobs.complete(jobId, notes, customEndTime);
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

    // Dynamic duration preview calculation as user edits finish date or finish time
    setTimeout(() => {
      const dateEl = document.getElementById('job-finish-date');
      const timeEl = document.getElementById('job-finish-time');
      const prevEl = document.getElementById('complete-duration-preview');

      function updatePreview() {
        if (!dateEl || !timeEl || !prevEl) return;
        const parsed = new Date(`${dateEl.value}T${timeEl.value}`);
        if (!isNaN(parsed.getTime())) {
          prevEl.textContent = formatDuration(parsed.getTime() - job.startTime);
        }
      }

      dateEl?.addEventListener('change', updatePreview);
      timeEl?.addEventListener('change', updatePreview);
    }, 100);
  }

  /* -------- Live Timers -------- */

  function _startLiveTimers() {
    _stopLiveTimers();
    _timerId = setInterval(() => {
      const activeJobs = (_jobs || []).filter(j => j && j.status === 'active');
      activeJobs.forEach(job => {
        const el = document.getElementById(`timer-${job.id}`);
        if (el) {
          const st = job.startTime || job.createdAt || Date.now();
          el.textContent = `⏱️ ${formatDuration(Date.now() - st)}`;
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
    if (!ms || isNaN(ms) || ms < 0) return '0m';
    const totalSec = Math.floor(ms / 1000);
    const hrs  = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;

    if (hrs > 0) return `${hrs}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  }

  function formatTime(ts) {
    if (!ts || isNaN(ts)) return '';
    try {
      return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    } catch(e) { return ''; }
  }

  function formatDate(ts) {
    if (!ts || isNaN(ts)) return '';
    try {
      return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch(e) { return ''; }
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { render };
})();
