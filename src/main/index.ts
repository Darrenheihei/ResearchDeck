import { app, nativeImage, shell, BrowserWindow, Menu } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import macosIcon from '../../resources/icon-macos.png?asset'
import { registerIpcHandlers } from './ipc'
import { registerVaultSchemePrivileges, registerVaultProtocolHandler } from './vaultProtocol'

// Custom vault-file protocol — must be registered before the app is ready.
registerVaultSchemePrivileges()

/**
 * Application menu without global zoom accelerators: ⌘/Ctrl +/−/0 stay free for
 * the PDF viewer's document-scoped zoom. Edit roles keep ⌘C/⌘V etc. working.
 */
function createAppMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }]
    }
  ]
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    // Hidden title bar: removes the native title-text bar while keeping the
    // native window controls (traffic lights on macOS, overlay caption
    // buttons on Windows). The renderer headers act as drag regions.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 13 } }
      : {}),
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: { color: '#f6f6f8', symbolColor: '#4a4a55', height: 40 }
        }
      : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Native context menu for selected or editable text (chrome stays menu-free).
  mainWindow.webContents.on('context-menu', (_, params) => {
    if (!params.isEditable && !params.selectionText.trim()) return
    const items: Electron.MenuItemConstructorOptions[] = [
      { role: 'copy', label: 'Copy' },
      ...(params.isEditable
        ? ([
            { role: 'cut', label: 'Cut' },
            { role: 'paste', label: 'Paste' }
          ] as const)
        : []),
      { type: 'separator' },
      { role: 'selectAll', label: 'Select All' }
    ]
    Menu.buildFromTemplate(items).popup({ window: mainWindow })
  })

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
  electronApp.setAppUserModelId('com.researchdeck.app')

  // Runtime dock icon for dev sessions — corrects the icon immediately even if
  // the macOS Dock is still serving a stale cached bundle icon. The dev
  // bundle's own icns is also replaced by scripts/generate-icons.mjs, so the
  // icon stays correct while quitting (no default-icon flash).
  if (process.platform === 'darwin') {
    app.dock?.setIcon(nativeImage.createFromPath(macosIcon))
  }

  // Vault-file streaming protocol for the renderer (PDF viewer etc.)
  registerVaultProtocolHandler()

  createAppMenu()

  // Vault/settings/dialog IPC handlers
  registerIpcHandlers()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
