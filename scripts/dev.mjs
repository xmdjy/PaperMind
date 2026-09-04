import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const environment = { ...process.env }

if (process.platform === 'darwin') {
  const electronSource = resolve('node_modules/electron/dist/Electron.app')
  const overrideDirectory = resolve('node_modules/.papermind-electron')
  const paperMindApp = resolve(overrideDirectory, 'Electron.app')

  if (!existsSync(paperMindApp)) {
    mkdirSync(overrideDirectory, { recursive: true })
    cpSync(electronSource, paperMindApp, { recursive: true })
  }

  const infoPlist = resolve(paperMindApp, 'Contents/Info.plist')
  execFileSync('plutil', ['-replace', 'CFBundleDisplayName', '-string', 'PaperMind', infoPlist])
  execFileSync('plutil', ['-replace', 'CFBundleName', '-string', 'PaperMind', infoPlist])
  environment.ELECTRON_OVERRIDE_DIST_PATH = overrideDirectory
}

const vite = resolve('node_modules/.bin/vite')
const child = spawn(vite, process.argv.slice(2), {
  env: environment,
  shell: process.platform === 'win32',
  stdio: 'inherit',
})

child.on('exit', code => process.exit(code ?? 1))
