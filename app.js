// ============================================
// Database Setup - IndexedDB
// ============================================
let db;
const DB_NAME = 'PulsePartsDB';
const DB_VERSION = 1;
const STORES = {
  accounts: 'accounts',
  details: 'details',
  documents: 'documents',
  settings: 'settings'
};

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onupgradeneeded = (event) => {
      db = event.target.result;
      
      // ذخیره‌سازی دفاتر معین
      if (!db.objectStoreNames.contains(STORES.accounts)) {
        const store = db.createObjectStore(STORES.accounts, { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        store.createIndex('name', 'name', { unique: true });
      }
      
      // ذخیره‌سازی دفاتر تفصیلی
      if (!db.objectStoreNames.contains(STORES.details)) {
        const store = db.createObjectStore(STORES.details, { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        store.createIndex('account', 'account', { unique: false });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('account_name', ['account', 'name'], { unique: true });
      }
      
      // ذخیره‌سازی اسناد
      if (!db.objectStoreNames.contains(STORES.documents)) {
        const store = db.createObjectStore(STORES.documents, { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        store.createIndex('number', 'number', { unique: false });
        store.createIndex('account', 'account', { unique: false });
        store.createIndex('detail', 'detail', { unique: false });
        store.createIndex('date', 'date', { unique: false });
      }
      
      // تنظیمات
      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: 'key' });
      }
    };
    
    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };
    
    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

// ============================================
// CRUD Operations
// ============================================
async function addRecord(storeName, data) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.add(data);
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllRecords(storeName) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function updateRecord(storeName, id, data) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put({ ...data, id });
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteRecord(storeName, id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(id);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function clearStore(storeName) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.clear();
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ============================================
// Application State
// ============================================
let appData = {
  accounts: [],
  details: [],
  documents: []
};

let currentEdit = null;
let busy = false;
let deleteTarget = null;

// ============================================
// Data Loading
// ============================================
async function loadData() {
  try {
    const [accounts, details, documents] = await Promise.all([
      getAllRecords(STORES.accounts),
      getAllRecords(STORES.details),
      getAllRecords(STORES.documents)
    ]);
    
    appData = {
      accounts: accounts.map(a => a.name),
      details: details,
      documents: documents
    };
    
    renderAll();
    updateConnectionStatus();
  } catch (error) {
    console.error('Error loading data:', error);
    showToast('خطا در بارگذاری داده‌ها', 'error');
  }
}

// ============================================
// Save Functions
// ============================================
async function saveAccount(name) {
  const normalized = name.trim();
  if (!normalized) throw new Error('نام دفتر معین خالی است');
  
  const exists = appData.accounts.some(a => a === normalized);
  if (exists) throw new Error('این دفتر معین قبلاً ثبت شده است');
  
  await addRecord(STORES.accounts, { name: normalized });
  await loadData();
}

async function updateAccount(oldName, newName) {
  const accounts = await getAllRecords(STORES.accounts);
  const account = accounts.find(a => a.name === oldName);
  
  if (!account) throw new Error('دفتر معین پیدا نشد');
  
  await updateRecord(STORES.accounts, account.id, { name: newName });
  
  // به‌روزرسانی در اسناد و تفصیلی‌ها
  await updateRelatedRecords(oldName, newName);
  await loadData();
}

async function deleteAccount(name) {
  const accounts = await getAllRecords(STORES.accounts);
  const account = accounts.find(a => a.name === name);
  
  if (!account) throw new Error('دفتر معین پیدا نشد');
  
  // بررسی وجود اسناد
  const documents = await getAllRecords(STORES.documents);
  const hasDocuments = documents.some(d => d.account === name);
  if (hasDocuments) throw new Error('این دفتر معین دارای سند است');
  
  await deleteRecord(STORES.accounts, account.id);
  await loadData();
}

async function saveDetail(data) {
  const details = await getAllRecords(STORES.details);
  const exists = details.some(d => 
    d.account === data.account && d.name === data.name
  );
  
  if (exists) throw new Error('این تفصیلی قبلاً ثبت شده است');
  
  await addRecord(STORES.details, data);
  await loadData();
}

async function updateDetail(id, data) {
  await updateRecord(STORES.details, id, data);
  await loadData();
}

async function deleteDetail(id) {
  const details = await getAllRecords(STORES.details);
  const detail = details.find(d => d.id === id);
  
  if (!detail) throw new Error('تفصیلی پیدا نشد');
  
  const documents = await getAllRecords(STORES.documents);
  const hasDocuments = documents.some(d => 
    d.account === detail.account && d.detail === detail.name
  );
  
  if (hasDocuments) throw new Error('این تفصیلی دارای سند است');
  
  await deleteRecord(STORES.details, id);
  await loadData();
}

async function saveDocument(data) {
  const documents = await getAllRecords(STORES.documents);
  
  // شماره سند بعدی
  let maxNumber = 0;
  documents.forEach(d => {
    const n = parseInt(d.number);
    if (n > maxNumber) maxNumber = n;
  });
  
  data.number = String(maxNumber + 1);
  data.createdAt = new Date().toISOString();
  
  await addRecord(STORES.documents, data);
  await loadData();
}

async function updateDocument(id, data) {
  await updateRecord(STORES.documents, id, data);
  await loadData();
}

async function deleteDocument(id) {
  await deleteRecord(STORES.documents, id);
  await loadData();
}

// ============================================
// Helper Functions
// ============================================
async function updateRelatedRecords(oldName, newName) {
  const details = await getAllRecords(STORES.details);
  const documents = await getAllRecords(STORES.documents);
  
  // به‌روزرسانی تفصیلی‌ها
  for (const detail of details) {
    if (detail.account === oldName) {
      await updateRecord(STORES.details, detail.id, {
        ...detail,
        account: newName
      });
    }
  }
  
  // به‌روزرسانی اسناد
  for (const doc of documents) {
    if (doc.account === oldName) {
      await updateRecord(STORES.documents, doc.id, {
        ...doc,
        account: newName
      });
    }
  }
}

// ============================================
// Export/Import Data (Backup)
// ============================================
async function exportData() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    accounts: await getAllRecords(STORES.accounts),
    details: await getAllRecords(STORES.details),
    documents: await getAllRecords(STORES.documents)
  };
  
  const blob = new Blob([JSON.stringify(data, null, 2)], { 
    type: 'application/json' 
  });
  
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importData(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  
  // پاک کردن داده‌های موجود
  await clearStore(STORES.accounts);
  await clearStore(STORES.details);
  await clearStore(STORES.documents);
  
  // وارد کردن داده‌ها
  for (const account of data.accounts) {
    await addRecord(STORES.accounts, account);
  }
  
  for (const detail of data.details) {
    await addRecord(STORES.details, detail);
  }
  
  for (const doc of data.documents) {
    await addRecord(STORES.documents, doc);
  }
  
  await loadData();
  showToast('داده‌ها با موفقیت بازیابی شدند');
}

// ============================================
// Initialize App
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await openDB();
    await loadData();
    
    // ثبت Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js')
        .then(() => console.log('Service Worker registered'))
        .catch(err => console.error('SW registration failed:', err));
    }
  } catch (error) {
    console.error('Failed to initialize:', error);
    showToast('خطا در راه‌اندازی برنامه', 'error');
  }
});
