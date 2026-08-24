const { contextBridge, ipcRenderer } = require('electron')

// Безопасный мост: рендерер (Vue) вызывает печать, сокет открывается в main-процессе.
contextBridge.exposeInMainWorld('electronPrinter', {
  isElectron: true,
  print: (opts) => ipcRenderer.invoke('printer:print', opts),
})

// Мост состояния сети: нужен экрану offline.html и фронту, если он захочет
// реагировать на обрыв связи сам.
contextBridge.exposeInMainWorld('electronNet', {
  retry: () => ipcRenderer.invoke('net:retry'),
  onStatus: (cb) => ipcRenderer.on('net:status', (_evt, online) => cb(online)),
})

/**
 * Полоса «нет интернета» поверх страницы. Живёт в preload, а не во фронте,
 * чтобы предупреждение работало без правок Vue-приложения и на любой его версии,
 * которая приедет с сервера.
 */
const BANNER_ID = '__wirehouse_offline_banner'
const BANNER_TEXT =
  'Нет подключения к интернету. Данные не сохраняются на сервер — подключите интернет и повторите действие.'

function showBanner() {
  if (!document.body || document.getElementById(BANNER_ID)) return
  const bar = document.createElement('div')
  bar.id = BANNER_ID
  bar.textContent = BANNER_TEXT
  bar.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'right:0',
    'z-index:2147483647',
    'padding:10px 16px',
    'background:#dc2626',
    'color:#fff',
    'font:500 14px/1.4 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
    'text-align:center',
    'box-shadow:0 1px 6px rgba(0,0,0,.25)',
  ].join(';')
  document.body.appendChild(bar)
}

function hideBanner() {
  document.getElementById(BANNER_ID)?.remove()
}

let online = true

function render() {
  if (online) hideBanner()
  else showBanner()
  console.log('WIREHOUSE_NET online=' + online)
}

ipcRenderer.on('net:status', (_evt, isOnline) => {
  online = isOnline
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, { once: true })
  else render()
})
