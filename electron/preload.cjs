const { contextBridge, ipcRenderer } = require('electron')

// Безопасный мост: рендерер (Vue) вызывает печать, сокет открывается в main-процессе.
contextBridge.exposeInMainWorld('electronPrinter', {
  isElectron: true,
  print: (opts) => ipcRenderer.invoke('printer:print', opts),
})
