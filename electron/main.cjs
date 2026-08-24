const { app, BrowserWindow, ipcMain, session, shell } = require('electron')
const http = require('node:http')
const https = require('node:https')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')

const DIST = path.join(__dirname, '..', 'dist')
// Экран без интернета общий с Android-сборкой: лежит в public/, попадает в dist/.
const OFFLINE_PAGE = path.join(DIST, 'offline.html')

/**
 * Фронт живёт на сервере: правки долетают до уже установленных копий после
 * перезапуска окна, пересобирать .exe не нужно. Локальный dist/ остаётся
 * аварийным запасом на случай, когда сайт лежит, а API жив.
 */
const REMOTE_URL = process.env.WIREHOUSE_URL || 'https://warehouse.front.amirjon.uz'
const API_URL = process.env.WIREHOUSE_API_URL || 'https://warehouse.api.amirjon.uz/api'
const PROBE_TIMEOUT = 4000
const CHECK_INTERVAL = 10000

// Куда окну разрешено ходить. Мост печати (electronPrinter) даёт странице сырой
// TCP-сокет, поэтому чужие домены в окно приложения не пускаем — они открываются
// во внешнем браузере.
const allowedOrigins = new Set([new URL(REMOTE_URL).origin])

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

let localUrl = null

/** Поднимает локальный сервер один раз и возвращает его адрес. */
async function getLocalUrl() {
  if (localUrl) return localUrl
  const server = await startServer()
  const { port } = server.address()
  localUrl = `http://127.0.0.1:${port}/`
  allowedOrigins.add(`http://127.0.0.1:${port}`)
  return localUrl
}

/** Отвечает ли адрес. Короткий таймаут, чтобы окно не висело белым при обрыве сети. */
function probe(url) {
  return new Promise((resolve) => {
    const client = url.startsWith('https:') ? https : http
    const req = client.request(url, { method: 'HEAD', timeout: PROBE_TIMEOUT }, (res) => {
      res.resume()
      // 401/404 от API — это тоже «связь есть», важен сам факт ответа.
      resolve(res.statusCode > 0 && res.statusCode < 500)
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
    req.end()
  })
}

function webPreferences() {
  return {
    preload: path.join(__dirname, 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
  }
}

function isAllowed(url) {
  try {
    return allowedOrigins.has(new URL(url).origin)
  } catch {
    return false
  }
}

function openExternal(url) {
  if (/^https?:$/.test(new URL(url).protocol)) shell.openExternal(url)
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

// Накладная/чек открывается через target="_blank" (новое окно). Даём новому
// окну тот же preload, иначе в нём не будет моста печати (electronPrinter).
// Всё, что ведёт за пределы разрешённых доменов, уходит во внешний браузер.
app.on('web-contents-created', (_evt, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (!isAllowed(url)) {
      openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: webPreferences() } }
  })
  contents.on('will-navigate', (event, url) => {
    if (isAllowed(url)) return
    event.preventDefault()
    openExternal(url)
  })
})

let mainWindow = null
let mode = 'offline' // 'remote' | 'local' | 'offline'
let routing = false

/**
 * Куда вести окно:
 *  remote  — сайт отвечает, работаем на серверной версии фронта;
 *  local   — сайт лежит, но API жив: показываем вшитый dist/ против живого API;
 *  offline — интернета нет, показываем экран-предупреждение.
 */
async function decide() {
  if (await probe(REMOTE_URL)) return 'remote'
  if (await probe(API_URL)) return 'local'
  return 'offline'
}

async function route(win) {
  if (routing || !win || win.isDestroyed()) return
  routing = true
  try {
    mode = await decide()
    if (mode === 'offline') await win.loadFile(OFFLINE_PAGE)
    else if (mode === 'remote') await win.loadURL(REMOTE_URL)
    else await win.loadURL(await getLocalUrl())
    console.log('WIREHOUSE_DESKTOP_READY source=' + mode)
  } catch (err) {
    console.log('WIREHOUSE_DESKTOP_LOAD_FAILED ' + err.message)
  } finally {
    routing = false
  }
}

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** Кнопка «Проверить сейчас» на экране без интернета. */
ipcMain.handle('net:retry', async (evt) => {
  await route(BrowserWindow.fromWebContents(evt.sender))
})

/**
 * Связь может пропасть уже во время работы — тогда поверх приложения появляется
 * красная полоса (её рисует preload). А если окно висит на экране без интернета,
 * оно само уйдёт на приложение, как только связь вернулась.
 */
function startConnectivityWatch() {
  setInterval(async () => {
    if (routing || !mainWindow || mainWindow.isDestroyed()) return
    if (mode === 'offline') {
      if ((await probe(API_URL)) || (await probe(REMOTE_URL))) await route(mainWindow)
      return
    }
    broadcast('net:status', await probe(API_URL))
  }, CHECK_INTERVAL)
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    webPreferences: webPreferences(),
  })

  // Связь оборвалась посреди навигации — уводим на экран-предупреждение,
  // обратно вернёт периодическая проверка.
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, _desc, _url, isMainFrame) => {
    if (!isMainFrame || routing || errorCode === -3 /* ABORTED */) return
    mode = 'offline'
    mainWindow.loadFile(OFFLINE_PAGE)
  })

  await route(mainWindow)
}

/**
 * index.html сервер отдаёт без Cache-Control, поэтому Chromium кэширует его
 * «на глазок» (по 10% от возраста файла) и приложение может сутками показывать
 * старую версию фронта. Просим перепроверять сам документ на каждой загрузке;
 * хешированные /assets/* это не трогает — они по-прежнему берутся из кэша.
 */
function alwaysRevalidateDocument() {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*/*'], types: ['mainFrame'] },
    (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, 'Cache-Control': 'no-cache' } })
    },
  )
}

app.whenReady().then(async () => {
  alwaysRevalidateDocument()
  await createWindow()
  startConnectivityWatch()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
