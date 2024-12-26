import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, chmodSync, statSync } from 'fs'
import { platform } from 'os'
import { StorageData, ModifyResult, CurrentIds } from './types'

function getStoragePath(): string {
  const home = homedir()
  
  switch (platform()) {
    case 'win32':
      return join(home, 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'storage.json')
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'storage.json')
    case 'linux':
      return join(home, '.config', 'Cursor', 'User', 'globalStorage', 'storage.json')
    default:
      throw new Error('不支持的操作系统')
  }
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c == 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

function generateMachineId(): string {
  // 生成32字节的十六进制字符串
  const bytes = new Array(32).fill(0).map(() => Math.floor(Math.random() * 256))
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('')
}

function generateSqmId(): string {
  // 生成带大括号的UUID格式
  return `{${generateUUID().toUpperCase()}}`
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 550,
    show: false,
    autoHideMenuBar: true,
    frame: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    center: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 设置窗口大小限制
  mainWindow.setMinimumSize(800, 550)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC Handlers
  ipcMain.handle('get-current-ids', async (): Promise<CurrentIds> => {
    try {
      const configPath = getStoragePath()
      let data: StorageData = {}
      
      if (existsSync(configPath)) {
        const content = readFileSync(configPath, 'utf8')
        data = JSON.parse(content)
      }

      return {
        configPath,
        machineId: data['telemetry.machineId'] || '',
        macMachineId: data['telemetry.macMachineId'] || '',
        devDeviceId: data['telemetry.devDeviceId'] || '',
        sqmId: data['telemetry.sqmId'] || ''
      }
    } catch (error) {
      const err = error as Error
      throw new Error(`读取配置失败: ${err.message || '未知错误'}`)
    }
  })

  ipcMain.handle('modify-ids', async (): Promise<ModifyResult> => {
    try {
      const configPath = getStoragePath()
      let data: StorageData = {}
      
      if (existsSync(configPath)) {
        const content = readFileSync(configPath, 'utf8')
        data = JSON.parse(content)
      }

      // 生成新的 ID
      data['telemetry.machineId'] = generateMachineId()
      data['telemetry.macMachineId'] = generateUUID()
      data['telemetry.devDeviceId'] = generateUUID()
      data['telemetry.sqmId'] = generateSqmId()

      // 写入文件
      writeFileSync(configPath, JSON.stringify(data, null, 2))

      return { success: true }
    } catch (error) {
      const err = error as Error
      return { success: false, error: err.message || '未知错误' }
    }
  })

  ipcMain.handle('set-file-permission', async (_, isReadOnly: boolean): Promise<ModifyResult> => {
    try {
      const configPath = getStoragePath()
      chmodSync(configPath, isReadOnly ? 0o444 : 0o666)
      return { success: true }
    } catch (error) {
      const err = error as Error
      return { success: false, error: err.message || '未知错误' }
    }
  })

  ipcMain.handle('check-file-permission', async (): Promise<{ isReadOnly: boolean }> => {
    try {
      const configPath = getStoragePath()
      const stats = statSync(configPath)
      // 检查文件是否为只读模式
      const isReadOnly = (stats.mode & 0o222) === 0
      return { isReadOnly }
    } catch (error) {
      const err = error as Error
      throw new Error(`检查文件权限失败: ${err.message || '未知错误'}`)
    }
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.