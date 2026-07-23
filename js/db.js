'use strict';

/* =============================================
   AttendPro — Database Layer (IndexedDB)
   ============================================= */

const DB = (() => {
  const DB_NAME = 'AttendancePro';
  const DB_VERSION = 2;
  let _db = null;

  /* -------- Utilities -------- */

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function p(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function store(name, mode = 'readonly') {
    return _db.transaction(name, mode).objectStore(name);
  }

  /* -------- Open / Init -------- */

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        if (!db.objectStoreNames.contains('employees')) {
          const s = db.createObjectStore('employees', { keyPath: 'id' });
          s.createIndex('name', 'name', { unique: false });
          s.createIndex('section', 'section', { unique: false });
        }
        if (!db.objectStoreNames.contains('sections')) {
          db.createObjectStore('sections', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('attendance')) {
          const s = db.createObjectStore('attendance', { keyPath: 'id' });
          s.createIndex('date', 'date', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('customFields')) {
          db.createObjectStore('customFields', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('jobs')) {
          const s = db.createObjectStore('jobs', { keyPath: 'id' });
          s.createIndex('status', 'status', { unique: false });
          s.createIndex('section', 'section', { unique: false });
          s.createIndex('date', 'date', { unique: false });
        }
      };

      req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  /* -------- Employees -------- */

  const employees = {
    getAll() { return p(store('employees').getAll()); },
    get(id) { return p(store('employees').get(id)); },

    async add(data) {
      const emp = {
        id: uid(),
        name: (data.name || '').trim(),
        employeeId: (data.employeeId || '').trim(),
        designation: (data.designation || '').trim(),
        phone: (data.phone || '').trim(),
        section: (data.section || '').trim(),
        customFields: data.customFields || {},
        createdAt: Date.now()
      };
      if (!emp.name) throw new Error('Name is required');
      await p(store('employees', 'readwrite').put(emp));
      return emp;
    },

    async update(emp) {
      emp.updatedAt = Date.now();
      await p(store('employees', 'readwrite').put(emp));
      return emp;
    },

    delete(id) { return p(store('employees', 'readwrite').delete(id)); },

    async import(list) {
      let added = 0;
      let updated = 0;
      const errors = [];
      const existing = await employees.getAll();

      for (const d of list) {
        try {
          if (d.section) await sections.ensure(d.section);

          const cleanName  = (d.name || '').trim();
          const cleanEmpId = (d.employeeId || '').trim();
          if (!cleanName) continue;

          // Match by ID, Employee ID or Name (case-insensitive)
          const match = existing.find(e =>
            (d.id && e.id === d.id) ||
            (cleanEmpId && e.employeeId && e.employeeId.toLowerCase() === cleanEmpId.toLowerCase()) ||
            (cleanName && e.name && e.name.toLowerCase() === cleanName.toLowerCase())
          );

          if (match) {
            // Overwrite existing record cleanly without creating a duplicate!
            const updatedEmp = {
              ...match,
              ...d,
              id: match.id, // keep original ID
              name: cleanName,
              employeeId: cleanEmpId || match.employeeId || '',
              designation: (d.designation || match.designation || '').trim(),
              phone: (d.phone || match.phone || '').trim(),
              section: (d.section || match.section || '').trim(),
              customFields: { ...(match.customFields || {}), ...(d.customFields || {}) },
              updatedAt: Date.now()
            };
            await p(store('employees', 'readwrite').put(updatedEmp));
            updated++;
          } else {
            // Truly new employee
            const emp = {
              id: d.id || uid(),
              name: cleanName,
              employeeId: cleanEmpId,
              designation: (d.designation || '').trim(),
              phone: (d.phone || '').trim(),
              section: (d.section || '').trim(),
              customFields: d.customFields || {},
              createdAt: d.createdAt || Date.now()
            };
            await p(store('employees', 'readwrite').put(emp));
            existing.push(emp); // add to in-memory list for next iterations
            added++;
          }
        } catch (e) {
          errors.push(`${d.name || 'Unknown'}: ${e.message}`);
        }
      }
      return { added, updated, errors };
    },

    async deduplicate() {
      const all = await employees.getAll();
      const seen = new Map();
      const idsToDelete = [];

      for (const emp of all) {
        const cleanName = (emp.name || '').trim().toLowerCase();
        const cleanEmpId = (emp.employeeId || '').trim().toLowerCase();
        const key = cleanEmpId || cleanName;
        if (!key) continue;

        if (seen.has(key)) {
          const existingEmp = seen.get(key);
          const existingScore = (existingEmp.employeeId ? 2 : 0) + (existingEmp.designation ? 1 : 0) + (existingEmp.section ? 1 : 0);
          const currentScore  = (emp.employeeId ? 2 : 0) + (emp.designation ? 1 : 0) + (emp.section ? 1 : 0);

          if (currentScore > existingScore) {
            idsToDelete.push(existingEmp.id);
            seen.set(key, emp);
          } else {
            idsToDelete.push(emp.id);
          }
        } else {
          seen.set(key, emp);
        }
      }

      for (const id of idsToDelete) {
        await employees.delete(id);
      }
      return idsToDelete.length;
    },

    async clearAll() {
      return p(store('employees', 'readwrite').clear());
    }
  };

  /* -------- Sections -------- */

  const sections = {
    getAll() { return p(store('sections').getAll()); },

    async add(name) {
      const s = { id: uid(), name: name.trim(), createdAt: Date.now() };
      await p(store('sections', 'readwrite').put(s));
      return s;
    },

    async update(s) {
      await p(store('sections', 'readwrite').put(s));
      return s;
    },

    delete(id) { return p(store('sections', 'readwrite').delete(id)); },

    async ensure(name) {
      const all = await sections.getAll();
      const found = all.find(s => s.name.toLowerCase() === name.toLowerCase().trim());
      return found || sections.add(name);
    }
  };

  /* -------- Attendance -------- */

  const attendance = {
    getAll() { return p(store('attendance').getAll()); },

    async getByKey(date, shift, company) {
      const all = await attendance.getAll();
      return all.find(r => r.date === date && r.shift === shift && r.company === company) || null;
    },

    async save(data) {
      const existing = await attendance.getByKey(data.date, data.shift, data.company);
      const rec = {
        id: existing ? existing.id : uid(),
        date: data.date,
        shift: data.shift,
        company: data.company,
        records: data.records || [],
        isFinalized: data.isFinalized !== undefined ? data.isFinalized : (existing ? existing.isFinalized : false),
        createdAt: existing ? existing.createdAt : Date.now(),
        updatedAt: Date.now()
      };
      await p(store('attendance', 'readwrite').put(rec));
      return rec;
    },

    delete(id) { return p(store('attendance', 'readwrite').delete(id)); },
    clearAll()  { return p(store('attendance', 'readwrite').clear()); }
  };

  /* -------- Settings -------- */

  const settings = {
    async get(key) {
      const r = await p(store('settings').get(key));
      return r !== undefined ? r.value : null;
    },
    set(key, value) {
      return p(store('settings', 'readwrite').put({ key, value }));
    }
  };

  /* -------- Custom Fields -------- */

  const customFields = {
    getAll() { return p(store('customFields').getAll()); },
    async add(name) {
      const f = { id: uid(), name: name.trim(), createdAt: Date.now() };
      await p(store('customFields', 'readwrite').put(f));
      return f;
    },
    delete(id) { return p(store('customFields', 'readwrite').delete(id)); }
  };

  /* -------- Jobs -------- */

  const jobs = {
    getAll() { return p(store('jobs').getAll()); },
    get(id) { return p(store('jobs').get(id)); },
    async add(data) {
      const assignedEmps = data.assignedEmps || [];
      const hasEmps = assignedEmps.length > 0;

      const job = {
        id: uid(),
        title: (data.title || '').trim(),
        section: (data.section || 'General').trim(),
        description: (data.description || '').trim(),
        assignedEmps,
        status: hasEmps ? 'active' : 'pending', // 'pending' | 'active' | 'completed'
        startTime: hasEmps ? (data.startTime || Date.now()) : null,
        endTime: null,
        durationMs: null,
        completionNotes: '',
        date: data.date || new Date().toISOString().split('T')[0],
        createdAt: Date.now()
      };
      if (!job.title) throw new Error('Job title is required');
      await p(store('jobs', 'readwrite').put(job));
      return job;
    },
    async complete(id, notes = '', customEndTime = null) {
      const job = await jobs.get(id);
      if (!job) throw new Error('Job not found');
      job.status = 'completed';
      job.endTime = customEndTime || Date.now();
      job.durationMs = Math.max(0, job.endTime - (job.startTime || job.createdAt));
      job.completionNotes = notes.trim();
      job.updatedAt = Date.now();
      await p(store('jobs', 'readwrite').put(job));
      return job;
    },
    async assignManpower(id, assignedEmps) {
      const job = await jobs.get(id);
      if (!job) throw new Error('Job not found');
      job.assignedEmps = assignedEmps || [];
      if (job.assignedEmps.length > 0) {
        job.status = 'active';
        if (!job.startTime) job.startTime = Date.now(); // Start timer when manpower assigned!
      } else {
        job.status = 'pending';
        job.startTime = null;
      }
      job.updatedAt = Date.now();
      await p(store('jobs', 'readwrite').put(job));
      return job;
    },
    async update(job) {
      job.updatedAt = Date.now();
      await p(store('jobs', 'readwrite').put(job));
      return job;
    },
    delete(id) { return p(store('jobs', 'readwrite').delete(id)); },
    clearAll()  { return p(store('jobs', 'readwrite').clear()); }
  };

  return { open, uid, employees, sections, attendance, settings, customFields, jobs };
})();
