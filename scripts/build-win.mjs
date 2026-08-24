#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP_OUT = path.join(os.tmpdir(), 'wirehouse-electron-build')
const FINAL_OUT = path.join(ROOT, 'dist-electron')
const BUILDER_CLI = path.join(ROOT, 'node_modules', 'electron-builder', 'cli.js')

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BUILDER_CLI, ...args], { cwd: ROOT, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('electron-builder завершился с кодом ' + code)),
    )
  })
}

await rm(TMP_OUT, { recursive: true, force: true })
await run(['--win', `-c.directories.output=${TMP_OUT}`])

await mkdir(FINAL_OUT, { recursive: true })
const installers = (await readdir(TMP_OUT)).filter((f) => f.endsWith('.exe'))
if (installers.length === 0) throw new Error('electron-builder не создал .exe в ' + TMP_OUT)

for (const file of installers) {
  await copyFile(path.join(TMP_OUT, file), path.join(FINAL_OUT, file))
  console.log('\nУстановщик готов: ' + path.join('dist-electron', file))
}
