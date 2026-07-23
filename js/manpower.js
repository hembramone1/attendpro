'use strict';

/* =============================================
   AttendPro — Manpower Management Module
   ============================================= */

const Manpower = (() => {
  let _employees = [];
  let _sections  = [];
  let _customFields = [];
  let _filterSection = 'all';
  let _searchQuery   = '';

  /* -------- Render -------- */

  async function render() {
    _employees    = await DB.employees.getAll();
    _sections     = await DB.sections.getAll();
    _customFields = await DB.customFields.getAll();
    _filterSection = 'all';
    _searchQuery   = '';

    const screen = document.getElementById('screen-manpower');
    screen.innerHTML = getHTML();
    setup();
    renderList();
  }

  function getHTML() {
    return `
      <div class="flex items-center justify-between mb-8">
        <div>
          <div class="screen-title">👥 Manpower</div>
          <div class="screen-sub">Manage your workforce</div>
        </div>
        <div class="flex gap-8">
          <button class="btn btn-sm btn-outline" id="mp-template-btn" title="Download Excel Format Template">📄 Format</button>
          <button class="btn btn-sm btn-outline" id="mp-import-btn" title="Import CSV/Excel">📂 Import</button>
          <button class="btn btn-sm btn-outline" id="mp-export-btn" title="Export CSV">💾 Export</button>
        </div>
      </div>

      <!-- Search -->
      <div class="search-wrap mb-8">
        <span class="search-icon">🔍</span>
        <input type="search" class="search-input" id="mp-search" placeholder="Search by name or ID…">
      </div>

      <!-- Section filter tabs -->
      <div class="section-tabs" id="mp-section-tabs">
        <button class="sec-tab active" data-sec="all">All</button>
        ${_sections.sort((a,b) => a.name.localeCompare(b.name)).map(s => `
          <button class="sec-tab" data-sec="${escHtml(s.name)}">${escHtml(s.name)}</button>
        `).join('')}
      </div>

      <!-- Summary chip -->
      <div class="flex items-center justify-between mb-12">
        <div class="chip chip-default" id="mp-count">0 employees</div>
      </div>

      <!-- Employee list -->
      <div id="emp-list"></div>

      <!-- FAB -->
      <button class="fab" id="mp-add-fab" title="Add Employee">＋</button>

      <!-- Hidden file input for import -->
      <input type="file" id="mp-file-input" accept=".csv,.xlsx,.xls" style="display:none">
    `;
  }

  function renderList() {
    const list = _filtered();
    const el   = document.getElementById('emp-list');
    const chip = document.getElementById('mp-count');
    if (chip) chip.textContent = `${_employees.length} employee${_employees.length !== 1 ? 's' : ''}`;

    if (!list.length) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">👤</div>
          <div class="empty-title">${_employees.length ? 'No results found' : 'No employees yet'}</div>
          <div class="empty-desc">${_employees.length ? 'Try a different search or filter' : 'Add employees manually or import a CSV/Excel file'}</div>
          ${!_employees.length ? '<button class="btn btn-primary" id="emp-empty-add">+ Add First Employee</button>' : ''}
        </div>`;
      document.getElementById('emp-empty-add')?.addEventListener('click', showAddModal);
      return;
    }

    el.innerHTML = list.map(emp => `
      <div class="emp-item" data-id="${emp.id}">
        <div class="emp-avatar">${initials(emp.name)}</div>
        <div class="emp-info">
          <div class="emp-name">${escHtml(emp.name)}</div>
          <div class="emp-meta">${[emp.designation, emp.section].filter(Boolean).map(escHtml).join(' · ')}${emp.employeeId ? ' · #' + escHtml(emp.employeeId) : ''}</div>
        </div>
        <div class="emp-badge">
          <button class="icon-btn" data-edit="${emp.id}" title="Edit">✏️</button>
        </div>
      </div>
    `).join('');
  }

  function _filtered() {
    return _employees
      .filter(emp => {
        const secOk  = _filterSection === 'all' || emp.section === _filterSection;
        const srchOk = !_searchQuery ||
          emp.name.toLowerCase().includes(_searchQuery) ||
          (emp.employeeId || '').toLowerCase().includes(_searchQuery) ||
          (emp.designation || '').toLowerCase().includes(_searchQuery);
        return secOk && srchOk;
      })
      .sort((a,b) => a.name.localeCompare(b.name));
  }

  function setup() {
    // Search
    document.getElementById('mp-search').addEventListener('input', e => {
      _searchQuery = e.target.value.toLowerCase().trim();
      renderList();
    });

    // Section tabs
    document.getElementById('mp-section-tabs').addEventListener('click', e => {
      const btn = e.target.closest('.sec-tab');
      if (!btn) return;
      _filterSection = btn.dataset.sec;
      document.querySelectorAll('.sec-tab').forEach(b => b.classList.toggle('active', b === btn));
      renderList();
    });

    // FAB - add employee
    document.getElementById('mp-add-fab').addEventListener('click', showAddModal);

    // Template format download button
    document.getElementById('mp-template-btn').addEventListener('click', downloadTemplate);

    // Import button
    document.getElementById('mp-import-btn').addEventListener('click', () => {
      document.getElementById('mp-file-input').click();
    });
    document.getElementById('mp-file-input').addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) handleImport(file);
      e.target.value = '';
    });

    // Export CSV
    document.getElementById('mp-export-btn').addEventListener('click', exportCSV);

    // Employee item click (event delegation)
    document.getElementById('emp-list').addEventListener('click', e => {
      const editBtn = e.target.closest('[data-edit]');
      if (editBtn) { showEditModal(editBtn.dataset.edit); return; }

      const item = e.target.closest('.emp-item');
      if (item) showEditModal(item.dataset.id);
    });
  }

  /* -------- Add Modal -------- */

  function showAddModal() {
    App.modal({
      title: 'Add Employee',
      subtitle: 'Fill in the employee details',
      html: employeeFormHTML(null),
      confirmText: 'Save Employee',
      onConfirm: async () => {
        const data = readForm();
        if (!data) return false; // validation failed
        try {
          if (data.section) await DB.sections.ensure(data.section);
          const emp = await DB.employees.add(data);
          _employees.push(emp);
          _sections = await DB.sections.getAll();
          App.closeModal();
          App.toast(`${emp.name} added`, 'success');
          render(); // refresh whole screen to update tabs
          return false; // prevent double close
        } catch(e) {
          App.toast(e.message, 'error');
          return false; // keep modal open on error
        }
      }
    });
    setupFormAutocomplete();
  }

  /* -------- Edit Modal -------- */

  async function showEditModal(id) {
    const emp = _employees.find(e => e.id === id);
    if (!emp) return;

    App.modal({
      title: 'Edit Employee',
      subtitle: emp.name,
      html: employeeFormHTML(emp),
      confirmText: 'Save Changes',
      showDelete: true,
      onDelete: () => {
        App.confirm(`Delete ${emp.name}? This cannot be undone.`, async () => {
          await DB.employees.delete(emp.id);
          Firebase.triggerAutoPush();
          _employees = _employees.filter(e => e.id !== emp.id);
          renderList();
          App.toast(`${emp.name} deleted`, 'info');
          App.closeModal();
        });
      },
      onConfirm: async () => {
        const data = readForm();
        if (!data) return false;
        try {
          if (data.section) await DB.sections.ensure(data.section);
          Object.assign(emp, data);
          await DB.employees.update(emp);
          Firebase.triggerAutoPush();
          renderList();
          App.closeModal();
          App.toast('Changes saved', 'success');
          return false;
        } catch(e) {
          App.toast(e.message, 'error');
          return false;
        }
      }
    });
    setupFormAutocomplete();
  }

  function employeeFormHTML(emp) {
    const v = (k) => emp ? escHtml(emp[k] || '') : '';
    const sectionOptions = _sections.sort((a,b) => a.name.localeCompare(b.name)).map(s =>
      `<option value="${escHtml(s.name)}" ${emp && emp.section === s.name ? 'selected' : ''}>${escHtml(s.name)}</option>`
    ).join('');

    const customFieldsHTML = _customFields.map(f => `
      <div class="form-group">
        <label class="form-label">${escHtml(f.name)}</label>
        <input class="form-input" data-custom="${escHtml(f.id)}" data-custom-name="${escHtml(f.name)}"
          value="${emp && emp.customFields && emp.customFields[f.name] ? escHtml(emp.customFields[f.name]) : ''}"
          placeholder="${escHtml(f.name)}">
      </div>
    `).join('');

    return `
      <div class="form-group">
        <label class="form-label">Full Name *</label>
        <input class="form-input" id="f-name" placeholder="e.g. Rajesh Kumar" value="${v('name')}" required>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Employee ID</label>
          <input class="form-input" id="f-empid" placeholder="EMP001" value="${v('employeeId')}">
        </div>
        <div class="form-group">
          <label class="form-label">Phone</label>
          <input class="form-input" id="f-phone" placeholder="9876543210" value="${v('phone')}" type="tel">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Designation</label>
        <input class="form-input" id="f-designation" placeholder="e.g. Mechanic, Electrician" value="${v('designation')}">
      </div>
      <div class="form-group">
        <label class="form-label">Section</label>
        <select class="form-select" id="f-section">
          <option value="">— No section —</option>
          ${sectionOptions}
          <option value="__new__">+ Add new section…</option>
        </select>
      </div>
      <div id="new-section-inline" style="display:none;" class="form-group">
        <label class="form-label">New Section Name</label>
        <input class="form-input" id="f-new-section" placeholder="e.g. Auto-electrical Section">
      </div>
      ${customFieldsHTML}
    `;
  }

  function setupFormAutocomplete() {
    // Show new section input when "add new" selected
    setTimeout(() => {
      const sel = document.getElementById('f-section');
      if (!sel) return;
      sel.addEventListener('change', () => {
        const newSecWrap = document.getElementById('new-section-inline');
        if (!newSecWrap) return;
        if (sel.value === '__new__') {
          newSecWrap.style.display = 'block';
          document.getElementById('f-new-section')?.focus();
        } else {
          newSecWrap.style.display = 'none';
        }
      });
    }, 200);
  }

  function readForm() {
    const name = document.getElementById('f-name')?.value.trim();
    if (!name) { App.toast('Name is required', 'error'); return null; }

    let section = document.getElementById('f-section')?.value || '';
    if (section === '__new__') {
      section = document.getElementById('f-new-section')?.value.trim() || '';
    }

    const customFields = {};
    document.querySelectorAll('[data-custom]').forEach(el => {
      if (el.value.trim()) customFields[el.dataset.customName] = el.value.trim();
    });

    return {
      name,
      employeeId:  document.getElementById('f-empid')?.value.trim() || '',
      designation: document.getElementById('f-designation')?.value.trim() || '',
      phone:       document.getElementById('f-phone')?.value.trim() || '',
      section,
      customFields
    };
  }

  /* -------- Import -------- */

  async function handleImport(file) {
    App.toast('Processing file…', 'info');

    try {
      let rows;
      if (file.name.endsWith('.csv')) {
        rows = await parseCSV(file);
      } else {
        rows = await parseExcel(file);
      }

      if (!rows || !rows.length) {
        App.toast('No data found in file', 'error');
        return;
      }

      // Map columns
      const headers = Object.keys(rows[0]).map(h => h.toLowerCase().trim());
      const fieldMap = {
        name:        findHeader(headers, ['name', 'employee name', 'full name', 'staff name']),
        employeeId:  findHeader(headers, ['employee id', 'emp id', 'id', 'emp no', 'employee no', 'staff id']),
        designation: findHeader(headers, ['designation', 'post', 'role', 'position', 'job title']),
        phone:       findHeader(headers, ['phone', 'mobile', 'contact', 'phone no', 'mobile no']),
        section:     findHeader(headers, ['section', 'department', 'dept', 'group', 'area', 'unit'])
      };

      if (fieldMap.name === null) {
        App.toast('Could not find a "Name" column in the file', 'error');
        return;
      }

      const originalHeaders = Object.keys(rows[0]);
      const list = rows.map(row => ({
        name:        fieldMap.name !== null ? (row[originalHeaders[fieldMap.name]] || '').trim() : '',
        employeeId:  fieldMap.employeeId !== null ? (row[originalHeaders[fieldMap.employeeId]] || '').trim() : '',
        designation: fieldMap.designation !== null ? (row[originalHeaders[fieldMap.designation]] || '').trim() : '',
        phone:       fieldMap.phone !== null ? String(row[originalHeaders[fieldMap.phone]] || '').trim() : '',
        section:     fieldMap.section !== null ? (row[originalHeaders[fieldMap.section]] || '').trim() : ''
      })).filter(r => r.name);

      if (!list.length) {
        App.toast('No valid employee rows found', 'error');
        return;
      }

      const result = await DB.employees.import(list);
      await render();
      App.toast(`✅ Imported ${result.added} employees${result.errors.length ? ` (${result.errors.length} skipped)` : ''}`, 'success');
    } catch (e) {
      console.error(e);
      App.toast('Import failed: ' + e.message, 'error');
    }
  }

  function findHeader(headers, candidates) {
    for (const c of candidates) {
      const idx = headers.findIndex(h => h.includes(c));
      if (idx !== -1) return idx;
    }
    return null;
  }

  function parseCSV(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target.result;
          const lines = text.split(/\r?\n/).filter(l => l.trim());
          if (lines.length < 2) { resolve([]); return; }

          const sep = lines[0].includes(';') ? ';' : ',';
          const headers = parseCSVLine(lines[0], sep);
          const rows = [];
          for (let i = 1; i < lines.length; i++) {
            const vals = parseCSVLine(lines[i], sep);
            if (vals.every(v => !v.trim())) continue;
            const row = {};
            headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
            rows.push(row);
          }
          resolve(rows);
        } catch(e) { reject(e); }
      };
      reader.onerror = reject;
      reader.readAsText(file, 'UTF-8');
    });
  }

  function parseCSVLine(line, sep = ',') {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i+1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === sep && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  function parseExcel(file) {
    return new Promise((resolve, reject) => {
      if (typeof XLSX === 'undefined') {
        reject(new Error('Excel library not loaded'));
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
          resolve(rows);
        } catch(e) { reject(e); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  /* -------- Export CSV -------- */

  function exportCSV() {
    if (!_employees.length) { App.toast('No employees to export', 'warning'); return; }

    const stdHeaders = ['Name', 'Employee ID', 'Designation', 'Phone', 'Section'];
    const cfNames    = _customFields.map(f => f.name);
    const allHeaders = [...stdHeaders, ...cfNames];

    const rows = [allHeaders];
    _employees.sort((a,b) => a.name.localeCompare(b.name)).forEach(emp => {
      const row = [
        emp.name, emp.employeeId, emp.designation, emp.phone, emp.section,
        ...cfNames.map(n => (emp.customFields && emp.customFields[n]) || '')
      ];
      rows.push(row);
    });

    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadFile(csv, `Manpower_${Settings.getCompany()}_${fmtDate(new Date())}.csv`, 'text/csv');
    App.toast('Master data exported', 'success');
  }

  /* -------- Download Format Template -------- */

  function downloadTemplate() {
    const stdHeaders = ['Name', 'Employee ID', 'Designation', 'Phone', 'Section'];
    const cfNames    = _customFields.map(f => f.name);
    const allHeaders = [...stdHeaders, ...cfNames];

    const sampleRow1 = ['Rajesh Kumar', 'EMP101', 'Dumper Operator', '9876543210', 'Auto-Electrical', ...cfNames.map(() => '')];
    const sampleRow2 = ['Suresh Verma', 'EMP102', 'Fitter', '9876543211', 'Mechanical', ...cfNames.map(() => '')];

    const data = [allHeaders, sampleRow1, sampleRow2];

    if (typeof XLSX !== 'undefined') {
      const ws = XLSX.utils.aoa_to_sheet(data);
      // Auto width for columns
      ws['!cols'] = allHeaders.map(() => ({ wch: 18 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Manpower Format");
      XLSX.writeFile(wb, "Manpower_Data_Format.xlsx");
      App.toast('Format template downloaded (.xlsx)', 'success');
    } else {
      const csv = data.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
      downloadFile(csv, "Manpower_Data_Format.csv", 'text/csv');
      App.toast('Format template downloaded (.csv)', 'success');
    }
  }

  /* -------- Helpers -------- */

  function initials(name) {
    return (name || '?').split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmtDate(d) {
    return `${d.getDate().toString().padStart(2,'0')}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getFullYear()}`;
  }

  function downloadFile(content, name, mime) {
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { render };
})();
