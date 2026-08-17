const { app, BrowserWindow, ipcMain } = require('electron')
const http = require('node:http')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')

const DIST = path.join(__dirname, '..', 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase()
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
  fs.createReadStream(filePath).pipe(res)
}

/**
 * Локальный статик-сервер для собранного фронта (dist) с SPA-фолбэком:
 * абсолютные пути /assets/* резолвятся, а неизвестные маршруты отдают index.html,
 * чтобы vue-router (history mode) работал как в браузере.
 */
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      const filePath = path.join(DIST, urlPath)
      if (!filePath.startsWith(DIST)) {
        res.writeHead(403)
        res.end()
        return
      }
      fs.stat(filePath, (err, stat) => {
        if (!err && stat.isFile()) serveFile(res, filePath)
        else serveFile(res, path.join(DIST, 'index.html')) // SPA fallback
      })
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

/**
 * Печать: сырые ESC/POS байты (base64) на сетевой чек-принтер по TCP (порт 9100).
 * В десктопе, в отличие от браузера, сокет открывается напрямую.
 */
ipcMain.handle('printer:print', (_evt, { ip, port = 9100, dataBase64, timeout = 5000 }) => {
  return new Promise((resolve, reject) => {
    if (!ip) return reject(new Error('Не указан IP принтера'))
    const bytes = Buffer.from(dataBase64, 'base64')
    const socket = new net.Socket()
    let done = false
    const finish = (fn, arg) => {
      if (done) return
      done = true
      fn(arg)
    }
    socket.setTimeout(timeout)
    socket.on('timeout', () => {
      socket.destroy()
      finish(reject, new Error('Таймаут: принтер не ответил'))
    })
    socket.on('error', (e) => finish(reject, new Error('Ошибка печати: ' + e.message)))
    socket.connect(port, ip, () => socket.write(bytes, () => socket.end()))
    socket.on('close', () => finish(resolve, { success: true }))
  })
})

async function createWindow() {
  const server = await startServer()
  const { port } = server.address()
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  // Накладная/чек открывается через target="_blank" (новое окно). Даём новому
  // окну тот же preload, иначе в нём не будет моста печати (electronPrinter).
  win.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    },
  }))

  win.loadURL(`http://127.0.0.1:${port}/`)
  win.webContents.once('did-finish-load', () => {
    console.log(`WIREHOUSE_DESKTOP_READY port=${port}`)
  })
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
