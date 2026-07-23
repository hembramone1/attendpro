'use strict';

/* =============================================
   AttendPro — Reports & Export Module
   ============================================= */

const Reports = (() => {
  let _allRecords  = [];
  let _employees   = [];
  let _allJobs     = [];
  let _calYear     = new Date().getFullYear();
  let _calMonth    = new Date().getMonth();
  let _selectedDate = null;
  let _selectedRec  = null;

  /* -------- Render Screen -------- */

  async function render() {
    const [recs, emps, jobs] = await Promise.all([
      DB.attendance.getAll(),
      DB.employees.getAll(),
      DB.jobs.getAll()
    ]);
    _allRecords = recs;
    _employees  = emps;
    _allJobs    = jobs;

    const screen = document.getElementById('screen-reports');
    screen.innerHTML = getHTML();
    setupEvents();
    renderCalendar();
  }

  function getHTML() {
    return `
      <div class="flex items-center justify-between mb-8">
        <div>
          <div class="screen-title">📊 Reports</div>
          <div class="screen-sub">Attendance &amp; Job history</div>
        </div>
        <button class="btn btn-sm btn-outline" id="rpt-export-excel">⬇️ Excel</button>
      </div>

      <!-- Month Navigator -->
      <div class="month-nav">
        <button class="icon-btn" id="cal-prev">‹</button>
        <div class="month-title" id="cal-month-title"></div>
        <button class="icon-btn" id="cal-next">›</button>
      </div>

      <!-- Calendar Grid -->
      <div class="cal-grid" id="cal-grid"></div>

      <!-- Selected Date Detail -->
      <div id="rpt-detail"></div>
    `;
  }

  /* -------- Calendar -------- */

  function renderCalendar() {
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    document.getElementById('cal-month-title').textContent = `${months[_calMonth]} ${_calYear}`;

    const grid = document.getElementById('cal-grid');
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    // Header
    let html = days.map(d => `<div class="cal-cell hd">${d}</div>`).join('');

    // Get dates with records (attendance OR jobs)
    const datesWithData = new Set([
      ..._allRecords.map(r => r.date),
      ..._allJobs.map(j => j.date)
    ]);
    const today = toYMD(new Date());

    const firstDay = new Date(_calYear, _calMonth, 1).getDay();
    const daysInMonth = new Date(_calYear, _calMonth + 1, 0).getDate();

    // Blanks
    for (let i = 0; i < firstDay; i++) html += '<div class="cal-cell empty"></div>';

    // Days
    for (let d = 1; d <= daysInMonth; d++) {
      const ymd   = `${_calYear}-${(_calMonth+1).toString().padStart(2,'0')}-${d.toString().padStart(2,'0')}`;
      const hasData = datesWithData.has(ymd);
      const isToday = ymd === today;
      const isSel   = ymd === _selectedDate;
      const cls = [
        'cal-cell',
        hasData && !isSel ? 'has-data' : '',
        isToday && !isSel ? 'today' : '',
        isSel ? 'selected' : '',
        !hasData && !isToday ? 'no-data' : ''
      ].filter(Boolean).join(' ');
      html += `<div class="${cls}" data-date="${ymd}">${d}</div>`;
    }

    grid.innerHTML = html;

    // Attach click
    grid.querySelectorAll('[data-date]').forEach(cell => {
      cell.addEventListener('click', () => selectDate(cell.dataset.date));
    });
  }

  function selectDate(date) {
    _selectedDate = date;
    renderCalendar(); // re-render to update selection
    renderDetail(date);
  }

  /* -------- Detail Panel -------- */

  async function renderDetail(date) {
    const detail = document.getElementById('rpt-detail');
    const records = _allRecords.filter(r => r.date === date);

    if (!records.length) {
      // Check if there are jobs even if attendance was not taken
      const dateJobs = _allJobs.filter(j => j.date === date || (j.startTime && toYMD(new Date(j.startTime)) === date));
      
      detail.innerHTML = `
        <div class="card mt-12 mb-12">
          <div class="empty-state" style="padding:16px">
            <div class="empty-icon" style="font-size:28px">📋</div>
            <div class="empty-title">No attendance taken for ${fmtDate(date)}</div>
          </div>
        </div>
        ${renderJobsReportHTML(dateJobs)}
      `;
      return;
    }

    // Shift selector if multiple shifts
    const shifts = records.map(r => r.shift);

    if (!_selectedRec || _selectedRec.date !== date) {
      _selectedRec = records[0];
    }

    const shiftTabsHTML = shifts.length > 1 ? `
      <div class="section-tabs mt-12" id="detail-shift-tabs">
        ${records.map(r => `<button class="sec-tab ${r.id === _selectedRec.id ? 'active' : ''}" data-rec-id="${r.id}">${r.shift} Shift</button>`).join('')}
      </div>
    ` : '';

    detail.innerHTML = `
      <div style="margin-top:16px">
        <div class="flex items-center justify-between mb-12">
          <div>
            <div style="font-size:16px;font-weight:800">${fmtDate(date)}</div>
            <div style="font-size:12px;color:var(--text-secondary)">${_selectedRec.company}</div>
          </div>
          <div class="flex gap-8">
            <button class="btn btn-sm btn-outline" id="detail-img-btn">🖼️ Image</button>
            <button class="btn btn-sm btn-secondary" id="detail-share-btn">📤 Share</button>
          </div>
        </div>

        ${shiftTabsHTML}

        <div id="detail-body"></div>
      </div>
    `;

    renderDetailBody();

    // Shift tabs
    detail.querySelectorAll('.sec-tab[data-rec-id]').forEach(tab => {
      tab.addEventListener('click', () => {
        const found = records.find(r => r.id === tab.dataset.recId);
        if (found) {
          _selectedRec = found;
          detail.querySelectorAll('.sec-tab[data-rec-id]').forEach(t => t.classList.toggle('active', t === tab));
          renderDetailBody();
        }
      });
    });

    document.getElementById('detail-img-btn').addEventListener('click', () => generateImage(_selectedRec));
    document.getElementById('detail-share-btn').addEventListener('click', () => generateAndShare(_selectedRec));
  }

  function renderDetailBody() {
    const body = document.getElementById('detail-body');
    if (!body) return;
    const rec = _selectedRec;

    const present = rec.records.filter(r => r.status === 'present');
    const absent  = rec.records.filter(r => r.status === 'absent');

    // Group present by section
    const sections = {};
    present.forEach(r => {
      const sec = r.section || 'Unassigned';
      if (!sections[sec]) sections[sec] = [];
      sections[sec].push(r);
    });

    // Total employees per section (from master)
    const totalBySec = {};
    _employees.forEach(e => {
      const sec = e.section || 'Unassigned';
      totalBySec[sec] = (totalBySec[sec] || 0) + 1;
    });

    const sectionHTML = Object.entries(sections).sort(([a],[b]) => a.localeCompare(b)).map(([sec, emps]) => {
      const pct  = totalBySec[sec] ? Math.round((emps.length / totalBySec[sec]) * 100) : 100;
      const color = pct >= 80 ? 'success' : pct >= 50 ? 'warning' : 'danger';
      return `
        <div class="sec-report">
          <div class="sec-report-hd">
            <div class="sec-report-name">${esc(sec)}</div>
            <div class="sec-report-count" style="color:var(--${color})">${emps.length}${totalBySec[sec] ? ' / ' + totalBySec[sec] : ''}</div>
          </div>
          <div class="progress-bar" style="margin:0;border-radius:0;height:3px"><div class="progress-fill ${color}" style="width:${pct}%"></div></div>
          <div class="sec-report-body">${emps.sort((a,b)=>a.name.localeCompare(b.name)).map(e => `<span class="name-chip">${esc(e.name)}</span>`).join('')}</div>
        </div>
      `;
    }).join('');

    const dateJobs = _allJobs.filter(j => j.date === _selectedDate || (j.startTime && toYMD(new Date(j.startTime)) === _selectedDate));

    body.innerHTML = `
      <div class="card mb-12" style="display:flex;gap:16px;justify-content:space-around">
        <div class="text-center"><div style="font-size:28px;font-weight:900;color:var(--success)">${present.length}</div><div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px">Present</div></div>
        <div style="width:1px;background:var(--border)"></div>
        <div class="text-center"><div style="font-size:28px;font-weight:900;color:var(--danger)">${absent.length}</div><div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px">Absent</div></div>
        <div style="width:1px;background:var(--border)"></div>
        <div class="text-center"><div style="font-size:28px;font-weight:900;color:var(--text-primary)">${rec.records.length}</div><div style="font-size:11px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px">Total</div></div>
      </div>
      <div class="sec-label">Section-wise Attendance — ${rec.shift} Shift</div>
      ${sectionHTML || `<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px">No present employees recorded</div>`}

      ${renderJobsReportHTML(dateJobs)}
    `;
  }

  /* -------- Helper to Render Jobs Report HTML -------- */

  function renderJobsReportHTML(dateJobs) {
    if (!dateJobs || !dateJobs.length) {
      return `<div class="sec-label mt-16">🛠️ Jobs &amp; Work Performed</div><div class="card mb-12 text-center" style="padding:14px;color:var(--text-muted);font-size:13px">No jobs recorded for this date</div>`;
    }

    const jobsHTML = dateJobs.map(job => {
      const isCompleted = job.status === 'completed';
      const startStr = job.startTime ? fmtTime(job.startTime) : 'N/A';
      const endStr = job.endTime ? fmtTime(job.endTime) : (isCompleted ? 'Finished' : 'In Progress');
      const durStr = formatDuration(job.durationMs || (isCompleted ? 0 : (Date.now() - job.startTime)));

      const empsHTML = (job.assignedEmps || []).map(e => `
        <span class="p-chip" style="font-size:11px;padding:3px 8px">👤 ${esc(e.name)} <span style="opacity:0.75;font-size:10px">(${esc(e.section || 'General')})</span></span>
      `).join('');

      return `
        <div class="card mb-12" style="border-left:4px solid ${isCompleted ? 'var(--success)' : 'var(--accent)'};padding:14px">
          <div class="flex items-center justify-between mb-8">
            <div>
              <span class="chip ${isCompleted ? 'chip-success' : 'chip-accent'}" style="font-size:10px">${esc(job.section)}</span>
              <div style="font-size:15px;font-weight:800;color:var(--text-primary);margin-top:4px">${esc(job.title)}</div>
            </div>
            <div class="chip ${isCompleted ? 'chip-success' : 'chip-warning'}" style="font-size:11px">
              ${isCompleted ? '✅ Finished' : '⚡ Active'}
            </div>
          </div>

          <div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px;display:flex;gap:12px;flex-wrap:wrap;background:var(--bg-elevated);padding:8px 10px;border-radius:var(--radius-sm)">
            <span>⏰ <strong>Start:</strong> ${startStr}</span>
            <span>🏁 <strong>Finish:</strong> ${endStr}</span>
            <span>⏱️ <strong>Duration:</strong> ${durStr}</span>
          </div>

          ${job.completionNotes ? `
            <div style="font-size:12px;color:var(--text-primary);margin-bottom:10px;background:var(--bg-card);padding:8px 10px;border-radius:var(--radius-sm);border:1px solid var(--border-bright)">
              <strong>📝 Work Done Summary:</strong> ${esc(job.completionNotes)}
            </div>
          ` : (job.description ? `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px"><strong>Description:</strong> ${esc(job.description)}</div>` : '')}

          <div>
            <div style="font-size:11px;font-weight:700;color:var(--text-secondary);margin-bottom:6px;text-transform:uppercase">👥 Engaged Manpower (${(job.assignedEmps || []).length})</div>
            <div class="flex flex-wrap gap-8">${empsHTML}</div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="sec-label mt-16">🛠️ Jobs &amp; Work Performed (${dateJobs.length})</div>
      ${jobsHTML}
    `;
  }

  /* -------- Calendar Navigation -------- */

  function setupEvents() {
    document.getElementById('cal-prev').addEventListener('click', () => {
      _calMonth--;
      if (_calMonth < 0) { _calMonth = 11; _calYear--; }
      renderCalendar();
    });
    document.getElementById('cal-next').addEventListener('click', () => {
      _calMonth++;
      if (_calMonth > 11) { _calMonth = 0; _calYear++; }
      renderCalendar();
    });

    document.getElementById('rpt-export-excel').addEventListener('click', exportExcel);
  }

  /* -------- Image Generation -------- */

  async function generateImage(record) {
    if (!record) { App.toast('No attendance record selected', 'warning'); return; }
    App.toast('Generating image…', 'info');

    try {
      // Populate the hidden image template
      const tpl = document.getElementById('att-img-tpl');
      tpl.innerHTML = buildImageHTML(record);
      tpl.style.display = 'block';

      // Wait for fonts to render
      await new Promise(r => setTimeout(r, 400));

      const canvas = await html2canvas(tpl, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false
      });

      tpl.style.display = 'none';

      // Convert to JPG blob
      canvas.toBlob(async (blob) => {
        const company = (record.company || 'Attendance').replace(/\s+/g, '_');
        const fname   = `Attendance_${company}_${record.date}_${record.shift}.jpg`;

        const url = URL.createObjectURL(blob);
        const a   = Object.assign(document.createElement('a'), { href: url, download: fname });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        App.toast('Image downloaded! 📷', 'success');
      }, 'image/jpeg', 0.92);
    } catch(e) {
      console.error(e);
      App.toast('Image generation failed: ' + e.message, 'error');
    }
  }

  async function generateAndShare(record) {
    if (!record) { App.toast('No attendance record to share', 'warning'); return; }
    App.toast('Preparing to share…', 'info');

    try {
      const tpl = document.getElementById('att-img-tpl');
      tpl.innerHTML = buildImageHTML(record);
      tpl.style.display = 'block';

      await new Promise(r => setTimeout(r, 400));

      const canvas = await html2canvas(tpl, {
        scale: 2, useCORS: true, allowTaint: true,
        backgroundColor: '#ffffff', logging: false
      });
      tpl.style.display = 'none';

      const company = (record.company || 'Attendance').replace(/\s+/g, '_');
      const fname   = `Attendance_${company}_${record.date}_${record.shift}.jpg`;

      canvas.toBlob(async (blob) => {
        const file = new File([blob], fname, { type: 'image/jpeg' });

        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({
              files: [file],
              title: `Attendance Report — ${record.date}`,
              text: `${record.company} Attendance | ${record.shift} Shift | ${record.date}`
            });
            App.toast('Shared!', 'success');
          } catch(e) {
            if (e.name !== 'AbortError') App.toast('Share failed', 'error');
          }
        } else {
          // Fallback: download
          const url = URL.createObjectURL(blob);
          const a   = Object.assign(document.createElement('a'), { href: url, download: fname });
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          App.toast('Image downloaded (sharing not supported on this browser)', 'info');
        }
      }, 'image/jpeg', 0.92);
    } catch(e) {
      console.error(e);
      App.toast('Failed: ' + e.message, 'error');
    }
  }

  function buildImageHTML(record) {
    const present = record.records.filter(r => r.status === 'present');
    const total   = record.records.length;

    // Group by section
    const sections = {};
    present.forEach(r => {
      const sec = r.section || 'Unassigned';
      if (!sections[sec]) sections[sec] = [];
      sections[sec].push(r);
    });

    // Total employees per section from master
    const totalBySec = {};
    _employees.forEach(e => {
      const sec = e.section || 'Unassigned';
      totalBySec[sec] = (totalBySec[sec] || 0) + 1;
    });

    const shiftTime = Settings.getShiftTime(record.shift);
    const now = new Date();
    const genTime = `${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

    const sectionsHTML = Object.entries(sections).sort(([a],[b]) => a.localeCompare(b)).map(([sec, emps]) => {
      const secTotal = totalBySec[sec] || emps.length;
      const pct = Math.round((emps.length / secTotal) * 100);
      const color = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#f43f5e';

      return `
        <div class="ait-section">
          <div class="ait-sec-hd">
            <div class="ait-sec-name">${esc(sec)}</div>
            <div class="ait-sec-cnt" style="color:${color}">${emps.length} / ${secTotal} Present</div>
          </div>
          <div class="ait-emp-grid">
            ${emps.sort((a,b) => a.name.localeCompare(b.name)).map((e, i) => `
              <div class="ait-emp">
                <span class="ait-emp-num">${i+1}.</span>
                <span class="ait-emp-name">${esc(e.name)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="ait-header">
        <div class="ait-company">${esc(record.company)}</div>
        <div class="ait-title">Daily Attendance Report</div>
        <div class="ait-meta">
          <div class="ait-meta-item"><span>📅</span><span>${fmtDate(record.date)}</span></div>
          <div class="ait-meta-item"><span>🕐</span><span>${esc(record.shift)} Shift</span></div>
          <div class="ait-meta-item"><span>⏰</span><span>${esc(shiftTime)}</span></div>
        </div>
      </div>
      ${sectionsHTML || '<div style="padding:20px;text-align:center;color:#94a3b8">No present employees</div>'}
      <div class="ait-footer">
        <div class="ait-total">Total Present: ${present.length} / ${total}</div>
        <div>Generated: ${genTime}</div>
      </div>
    `;
  }

  /* -------- Excel Export -------- */

  async function exportExcel() {
    if (typeof XLSX === 'undefined') {
      App.toast('Excel library not loaded. Check your connection.', 'error');
      return;
    }

    const allEmps = await DB.employees.getAll();
    if (!allEmps.length) { App.toast('No employees to export', 'warning'); return; }

    const allAtt  = await DB.attendance.getAll();
    if (!allAtt.length) { App.toast('No attendance data yet', 'warning'); return; }

    App.toast('Building Excel file…', 'info');

    // Collect all unique date+shift combinations
    const dateShiftKeys = [...new Set(allAtt.map(r => `${r.date}||${r.shift}||${r.company}`))].sort();

    // Build attendance lookup: empId -> { dateShiftKey: P/A }
    const lookup = {};
    allAtt.forEach(rec => {
      const key = `${rec.date}||${rec.shift}||${rec.company}`;
      rec.records.forEach(r => {
        if (!lookup[r.empId]) lookup[r.empId] = {};
        lookup[r.empId][key] = r.status === 'present' ? 'P' : 'A';
      });
    });

    // Column headers
    const headerRow1 = ['Emp ID', 'Name', 'Designation', 'Section', 'Phone'];
    const headerRow2 = [...headerRow1];
    dateShiftKeys.forEach(k => {
      const [date, shift, company] = k.split('||');
      headerRow1.push(fmtDate(date));
      headerRow2.push(shift);
    });

    // Data rows
    const rows = [headerRow1, headerRow2];
    allEmps.sort((a,b) => (a.section||'').localeCompare(b.section||'') || a.name.localeCompare(b.name)).forEach(emp => {
      const row = [emp.employeeId, emp.name, emp.designation, emp.section, emp.phone];
      dateShiftKeys.forEach(k => {
        row.push(lookup[emp.id]?.[k] || '-');
      });
      rows.push(row);
    });

    // Build workbook
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Style column widths
    ws['!cols'] = [
      { wch: 10 }, { wch: 24 }, { wch: 18 }, { wch: 22 }, { wch: 14 },
      ...dateShiftKeys.map(() => ({ wch: 8 }))
    ];

    // Freeze top 2 rows (header rows)
    ws['!views'] = [{ state: 'frozen', ySplit: 2 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance Register');

    const company = (Settings.getCompany() || 'Attendance').replace(/\s+/g, '_');
    const fname   = `Attendance_Register_${company}.xlsx`;
    XLSX.writeFile(wb, fname);

    App.toast('Excel exported!', 'success');
  }

  /* -------- Helpers -------- */

  function toYMD(d) {
    return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
  }

  function fmtDate(ymd) {
    if (!ymd) return '';
    const [y,m,d] = ymd.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${parseInt(d)} ${months[parseInt(m)-1]} ${y}`;
  }

  function esc(str) {
    return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function fmtTime(ts) {
    if (!ts) return '--:--';
    return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  function formatDuration(ms) {
    if (!ms || ms < 0) return '0m';
    const totalSec = Math.floor(ms / 1000);
    const hrs  = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  }

  return { render, generateAndShare, exportExcel };
})();
