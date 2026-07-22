'use strict';

/* =============================================
   AttendPro — Database Layer (IndexedDB)
   ============================================= */

const DB = (() => {
  const DB_NAME = 'AttendancePro';
  const DB_VERSION = 1;
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
      const errors = [];
      for (const d of list) {
        try {
          if (d.section) await sections.ensure(d.section);
          await employees.add(d);
          added++;
        } catch (e) {
          errors.push(`${d.name || 'Unknown'}: ${e.message}`);
        }
      }
      return { added, errors };
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

  return { open, uid, employees, sections, attendance, settings, customFields };
})();
