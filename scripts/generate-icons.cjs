#!/usr/bin/env electron
/**
 * Генератор иконок Wirehouse из одного источника — геометрии ниже.
 *
 * Растеризацией занимается сам Electron (Chromium уже умеет SVG), поэтому
 * никаких внешних зависимостей вроде sharp или ImageMagick не нужно.
 *
 * Что создаёт:
 *   assets/logo.svg                       — исходник, его же удобно открыть в редакторе
 *   public/favicon.svg                    — вкладка браузера
 *   build/icon.png (1024)                 — отсюда electron-builder делает .ico и .icns
 *   android/.../mipmap-DPI/ic_launcher.png            — иконка приложения (старые Android)
 *   android/.../mipmap-DPI/ic_launcher_round.png      — круглая (старые Android)
 *   android/.../mipmap-DPI/ic_launcher_foreground.png — передний слой adaptive-иконки
 *
 * Запуск: npm run icons
 */
const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res')

// Фирменные цвета: акцент приложения — indigo-600 (см. text-indigo-600 в src/).
const GRADIENT_FROM = '#6366F1'
const GRADIENT_TO = '#4338CA'

// Изометрическая коробка в квадрате 512×512. Центр коробки — (256, 276).
const CUBE = `
  <polygon points="256,116 396,196 256,276 116,196" fill="#fff"/>
  <polygon points="116,196 256,276 256,436 116,356" fill="#fff" opacity="0.78"/>
  <polygon points="396,196 256,276 256,436 396,356" fill="#fff" opacity="0.52"/>`

const GRADIENT = `
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${GRADIENT_FROM}"/>
      <stop offset="1" stop-color="${GRADIENT_TO}"/>
    </linearGradient>
  </defs>`

/** Основная иконка: коробка на плашке со скруглением. */
const badgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${GRADIENT}
  <rect width="512" height="512" rx="112" fill="url(#g)"/>${CUBE}
</svg>`

/** Круглая версия — для старых Android, где система не режет иконку сама. */
const roundSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${GRADIENT}
  <circle cx="256" cy="256" r="256" fill="url(#g)"/>${CUBE}
</svg>`

/**
 * Передний слой adaptive-иконки: только коробка на прозрачном фоне.
 * Android обрезает эти PNG под маску устройства, поэтому рисунок занимает
 * центральные ~55% холста — остальное съест обрезка.
 */
const foregroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <g transform="translate(256,256) scale(0.88) translate(-256,-276)">${CUBE}</g>
</svg>`

const DENSITIES = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
]

/**
 * Рисует SVG в PNG размером 1024 — дальше уменьшаем из него, так чище края.
 * Окно одно на все картинки: второе прозрачное offscreen-окно в том же процессе
 * на Windows отваливается с ERR_FAILED, поэтому переиспользуем первое.
 */
async function rasterize(win, svg) {
  const html = `<html><body style="margin:0;background:transparent">
    <div style="width:1024px;height:1024px">${svg.replace('width="512" height="512"', 'width="1024" height="1024"')}</div>
  </body></html>`
  // Chromium запрещает переход на data:-URL верхнего уровня, поэтому через файл.
  const tmp = path.join(os.tmpdir(), 'wirehouse-icon.html')
  fs.writeFileSync(tmp, html, 'utf8')
  await win.loadFile(tmp)
  await new Promise((r) => setTimeout(r, 400))
  const image = await win.webContents.capturePage()
  fs.unlinkSync(tmp)
  return image
}

function write(file, buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, buffer)
  console.log('  ' + path.relative(ROOT, file).replace(/\\/g, '/'))
}

function writeResized(image, size, file) {
  write(file, image.resize({ width: size, height: size, quality: 'best' }).toPNG())
}

app.whenReady().then(async () => {
  console.log('Исходники:')
  write(path.join(ROOT, 'assets', 'logo.svg'), badgeSvg)
  write(path.join(ROOT, 'public', 'favicon.svg'), badgeSvg)

  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  })
  const badge = await rasterize(win, badgeSvg)
  const round = await rasterize(win, roundSvg)
  const foreground = await rasterize(win, foregroundSvg)
  win.destroy()

  console.log('Windows / macOS:')
  write(path.join(ROOT, 'build', 'icon.png'), badge.toPNG())

  console.log('Android:')
  for (const [density, launcher, adaptive] of DENSITIES) {
    const dir = path.join(RES, 'mipmap-' + density)
    writeResized(badge, launcher, path.join(dir, 'ic_launcher.png'))
    writeResized(round, launcher, path.join(dir, 'ic_launcher_round.png'))
    writeResized(foreground, adaptive, path.join(dir, 'ic_launcher_foreground.png'))
  }

  console.log('\nГотово. Дальше: npm run electron:build:win и make apk')
  app.quit()
})
