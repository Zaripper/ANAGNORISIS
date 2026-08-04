const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('erp', {
  apiBaseUrl: (typeof process !== 'undefined' && process.env?.ERP_API_URL) 
    ? process.env.ERP_API_URL 
    : 'http://127.0.0.1:5000/api'
});