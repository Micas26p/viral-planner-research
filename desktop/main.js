'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, Menu, Notification, screen, shell, Tray } = require('electron');
const { ResearchBrowser } = require('./research-browser');

// The target Windows installation cannot start Chromium's GPU subprocess.
// Keep the stable software compositor without the old in-process GPU mode.
// Compatible machines can opt into the native GPU pipeline explicitly.
if (process.platform === 'win32' && process.env.VPR_ENABLE_GPU !== '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('in-process-gpu');
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,Av1Decoder');
app.setName('Viral Research');

const appRoot = path.resolve(__dirname, '..');
const runningFromElectronBinary = path.basename(process.execPath).toLowerCase() === 'electron.exe';
const isPackagedRuntime = app.isPackaged || !runningFromElectronBinary;
const storageDir = process.env.VPR_QA_STORAGE_DIR
  ? path.resolve(process.env.VPR_QA_STORAGE_DIR)
  : isPackagedRuntime ? path.dirname(process.execPath) : appRoot;
const desktopLog = path.join(storageDir, 'data', 'desktop.log');
app.setPath('userData', path.join(storageDir, 'data', 'electron-profile'));

function log(message) {
  try {
    fs.mkdirSync(path.dirname(desktopLog), { recursive: true });
    fs.appendFileSync(desktopLog, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch {
    // Logging is best-effort only.
  }
}

process.env.VPR_DESKTOP = '1';
process.env.VPR_STORAGE_DIR = storageDir;
process.env.HOST = '127.0.0.1';
process.env.PORT = process.env.PORT || '0';

log(`Desktop main loaded. exec=${process.execPath} appRoot=${appRoot}`);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  log('Another instance of Viral Research is already running. Quitting duplicate instance.');
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  log('Second instance attempt detected. Restoring and focusing main window.');
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

const {
  startServer,
  setBrowserResearchAdapter,
  executeHttpGraphTasks,
  setActiveResearchUserControl,
  setDesktopSettingsAdapter,
  settingsProfile,
  allResearchJobs,
  activeResearchJobs,
  hasActiveResearchJobs,
  pauseActiveResearch,
  resumeActiveResearch,
  cancelActiveResearch
} = require('../server');
log('Server module loaded.');

let mainWindow = null;
let serverHandle = null;
let mainWindowShown = false;
let researchBrowser = null;
let tray = null;
let trayTimer = null;
let isQuitting = false;
let quitAfterShutdown = false;
let shutdownPromise = null;
let desktopPreferences = {
  launchAtStartup: false,
  continueInTray: true,
  notifications: { complete: true, attention: true, error: true }
};
let desktopLanguage = 'en';
const notifiedJobStates = new Map();

async function createMainWindow() {
  log(`Starting desktop app. packaged=${isPackagedRuntime} storage=${storageDir}`);
  const iconPath = resolveIconPath();
  setDesktopSettingsAdapter({
    capabilities: () => ({ launchAtStartup: process.platform === 'win32', openDataFolder: true }),
    apply: applyDesktopPreferences,
    openDataFolder: () => shell.openPath(path.join(storageDir, 'data')),
    notify: (title, body) => notify(title, body, 'complete')
  });
  if (!researchBrowser) {
    researchBrowser = new ResearchBrowser({
      appRoot,
      icon: iconPath,
      controlHandler: setActiveResearchUserControl,
      taskExecutor: executeHttpGraphTasks
    });
    setBrowserResearchAdapter(researchBrowser);
    log('Local research browser connected.');
  }
  if (!serverHandle) {
    serverHandle = await startServer({
      host: '127.0.0.1',
      port: Number(process.env.PORT || 0)
    });
  }
  log(`Server ready at ${serverHandle.url}`);
  researchBrowser?.setServerUrl(serverHandle.url);

  log('Creating main window.');
  const workArea = screen.getPrimaryDisplay().workArea;
  const initialWidth = Math.min(workArea.width, Math.round(workArea.width * 1.02));
  const initialHeight = Math.min(workArea.height, Math.round(workArea.height * 0.96));
  const windowOptions = {
    x: workArea.x + Math.floor((workArea.width - initialWidth) / 2),
    y: workArea.y + Math.floor((workArea.height - initialHeight) / 2),
    width: initialWidth,
    height: initialHeight,
    minWidth: Math.min(1120, initialWidth),
    minHeight: Math.min(720, initialHeight),
    title: 'Viral Research',
    autoHideMenuBar: true,
    backgroundColor: '#f4f4ef',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Windows compatibility: renderer sandboxing fails to launch on some
      // machines; CSP, local-only origin and disabled Node access stay enforced.
      sandbox: false,
      backgroundThrottling: true
    }
  };

  if (process.platform !== 'win32' && iconPath) windowOptions.icon = iconPath;

  mainWindowShown = false;
  mainWindow = new BrowserWindow(windowOptions);
  mainWindow.webContents.setZoomFactor(1);
  const createdBounds = mainWindow.getBounds();
  log(`Main window created. bounds=${createdBounds.width}x${createdBounds.height} workArea=${workArea.width}x${workArea.height}`);

  mainWindow.on('close', event => {
    if (isQuitting) return;
    if (!hasActiveResearchJobs() || !desktopPreferences.continueInTray) {
      app.quit();
      return;
    }
    event.preventDefault();
    mainWindow.hide();
    notify(trayText('backgroundTitle'), trayText('backgroundBody'), 'attention');
    refreshTrayMenu();
  });

  mainWindow.webContents.session.webRequest.onBeforeRequest({
    urls: [
      `${serverHandle.url}/favicon.ico`
    ]
  }, (details, callback) => {
    callback({ cancel: true });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('focus', () => {
    mainWindow.flashFrame(false);
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    log(`Renderer process ended: ${details.reason || 'unknown'} ${details.exitCode ?? ''}`.trim());
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    log(`Window load failed: ${errorCode} ${errorDescription}`);
  });

  mainWindow.webContents.on('will-navigate', event => {
    const targetUrl = event.url || '';
    if (isInternalAppUrl(targetUrl)) return;
    if (isExternalUrl(targetUrl)) {
      event.preventDefault();
      shell.openExternal(targetUrl);
    }
  });

  mainWindow.once('ready-to-show', () => showMainWindow('ready-to-show'));
  mainWindow.webContents.once('dom-ready', () => showMainWindow('dom-ready'));
  mainWindow.webContents.once('did-finish-load', () => log('Main window did-finish-load.'));
  mainWindow.webContents.once('did-stop-loading', () => showMainWindow('did-stop-loading'));

  log('Waiting for local health endpoint.');
  await waitForHealth(serverHandle.url);
  log('Loading main window URL.');
  showMainWindow('before-load');
  const targetUrl = process.env.VPR_DESKTOP_URL
    || (process.env.VPR_BLANK_WINDOW === '1' ? 'about:blank' : '');
  const loadPromise = mainWindow.loadURL(targetUrl || `${serverHandle.url}/?desktop=1`);
  loadPromise
    .then(() => log('Main window loaded.'))
    .catch(err => log(`Main window load rejected: ${err && err.message ? err.message : err}`));
  await Promise.race([
    loadPromise,
    sleep(12000).then(() => log('Main window load still pending after 12s.'))
  ]);
  showMainWindow('load-wait-complete');
  createTray();
}

function showMainWindow(reason) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindowShown) return;
  mainWindowShown = true;
  log(`Showing main window: ${reason}`);
  mainWindow.show();
}

function showMainApp() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow().catch(err => log(`Window restore failed: ${err.message}`));
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) {
    refreshTrayMenu();
    return;
  }
  const iconPath = resolveIconPath();
  if (!iconPath) return;
  tray = new Tray(iconPath);
  tray.setToolTip('Viral Research');
  tray.on('double-click', showMainApp);
  refreshTrayMenu();
  trayTimer = setInterval(refreshTrayState, 3000);
}

function refreshTrayState() {
  const jobs = allResearchJobs().slice(0, 12);
  for (const job of jobs) {
    const previous = notifiedJobStates.get(job.id);
    if (job.status === 'needs_attention' && previous !== job.status) {
      notify(trayText('attentionTitle'), job.message || trayText('attentionBody'), 'attention');
      if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true);
    }
    if (job.status === 'complete' && previous !== job.status) {
      notify(trayText('completeTitle'), `${job.discovery?.channelsFound || 0} ${trayText('channelsDiscovered')}`, 'complete');
      if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true);
    }
    if (job.status === 'error' && previous && previous !== job.status) {
      notify(trayText('errorTitle'), job.errors?.[0] || trayText('errorBody'), 'error');
      if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true);
    }
    notifiedJobStates.set(job.id, job.status);
  }
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const jobs = activeResearchJobs();
  const hasJobs = jobs.length > 0;
  const hasRunning = jobs.some(job => ['queued', 'running', 'needs_attention'].includes(job.status));
  const hasPaused = jobs.some(job => job.status === 'paused');
  const status = jobs[0]?.message || 'Idle';
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `${trayText('status')}: ${status}`, enabled: false },
    { type: 'separator' },
    { label: trayText('open'), click: showMainApp },
    { label: trayText('inspect'), enabled: Boolean(researchBrowser), click: () => researchBrowser?.expand() },
    { type: 'separator' },
    { label: trayText('pause'), enabled: hasRunning, click: pauseActiveResearch },
    { label: trayText('resume'), enabled: hasPaused, click: resumeActiveResearch },
    { label: trayText('stop'), enabled: hasJobs, click: cancelActiveResearch },
    { type: 'separator' },
    {
      label: trayText('exit'),
      click: () => {
        app.quit();
      }
    }
  ]));
}

function notify(title, body, kind = 'complete') {
  if (!Notification.isSupported()) return;
  if (desktopPreferences.notifications?.[kind] === false) return;
  new Notification({ title, body, silent: false }).show();
}

function applyDesktopPreferences(desktop = {}, appearance = {}) {
  desktopPreferences = {
    ...desktopPreferences,
    ...desktop,
    notifications: { ...desktopPreferences.notifications, ...(desktop.notifications || {}) }
  };
  desktopLanguage = appearance.language === 'pt' || appearance.language === 'en'
    ? appearance.language
    : (String(app.getLocale() || '').toLowerCase().startsWith('pt') ? 'pt' : 'en');
  if (process.platform === 'win32' && isPackagedRuntime) {
    app.setLoginItemSettings({ openAtLogin: Boolean(desktopPreferences.launchAtStartup), path: process.execPath });
  }
  refreshTrayMenu();
}

function trayText(key) {
  const dictionary = {
    en: {
      status: 'Status', open: 'Open Viral Research', inspect: 'Inspect researcher', pause: 'Pause research',
      resume: 'Resume research', stop: 'Stop research', exit: 'Exit', backgroundTitle: 'Research continues in the background',
      backgroundBody: 'Viral Research is still scanning YouTube.', attentionTitle: 'Research needs attention',
      attentionBody: 'Open the local researcher to continue.', completeTitle: 'Research expedition complete',
      channelsDiscovered: 'channels discovered.', errorTitle: 'Research stopped after an error', errorBody: 'Open the app for details.'
    },
    pt: {
      status: 'Estado', open: 'Abrir Viral Research', inspect: 'Inspecionar pesquisador', pause: 'Pausar pesquisa',
      resume: 'Retomar pesquisa', stop: 'Parar pesquisa', exit: 'Sair', backgroundTitle: 'A pesquisa continua em segundo plano',
      backgroundBody: 'O Viral Research continua a analisar o YouTube.', attentionTitle: 'A pesquisa precisa de atenção',
      attentionBody: 'Abra o pesquisador local para continuar.', completeTitle: 'Expedição concluída',
      channelsDiscovered: 'canais descobertos.', errorTitle: 'A pesquisa parou devido a um erro', errorBody: 'Abra a aplicação para ver os detalhes.'
    }
  };
  return dictionary[desktopLanguage]?.[key] || dictionary.en[key] || key;
}

function resolveIconPath() {
  const candidates = [
    path.join(storageDir, 'icon.ico'),
    path.join(process.resourcesPath || '', 'icon.ico'),
    path.join(appRoot, 'build', 'icon.ico')
  ];
  return candidates.find(candidate => candidate && fs.existsSync(candidate));
}

function isExternalUrl(url) {
  if (!url) return false;
  if (url.startsWith('file://')) return false;
  return !isInternalAppUrl(url);
}

function isInternalAppUrl(url) {
  if (!serverHandle?.url) return false;
  try {
    const target = new URL(url);
    const server = new URL(serverHandle.url);
    return ['127.0.0.1', 'localhost'].includes(target.hostname)
      && target.port === server.port;
  } catch {
    return false;
  }
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The local server can take a moment to bind the port.
    }
    await sleep(300);
  }
  throw new Error('The local server did not become ready in time.');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function closeServer() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    if (trayTimer) clearInterval(trayTimer);
    trayTimer = null;
    const activeServer = serverHandle;
    const activeBrowser = researchBrowser;
    try {
      if (activeServer?.close) await activeServer.close();
    } catch (error) {
      log(`Server shutdown error: ${error?.message || error}`);
    }
    try {
      await activeBrowser?.close?.();
    } catch (error) {
      log(`Browser shutdown error: ${error?.message || error}`);
    }
    serverHandle = null;
    researchBrowser = null;
    setBrowserResearchAdapter(null);
    setDesktopSettingsAdapter(null);
    tray?.destroy?.();
    tray = null;
  })();
  return shutdownPromise;
}

app.whenReady().then(createMainWindow).catch(err => {
  log(`Startup error: ${err && err.stack ? err.stack : err}`);
  console.error(err);
  closeServer();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow().catch(err => {
      console.error(err);
      app.quit();
    });
  }
});

app.on('before-quit', event => {
  if (quitAfterShutdown) return;
  event.preventDefault();
  isQuitting = true;
  closeServer().finally(() => {
    quitAfterShutdown = true;
    app.quit();
  });
});

process.on('uncaughtException', err => {
  log(`Uncaught exception: ${err && err.stack ? err.stack : err}`);
});

process.on('unhandledRejection', err => {
  log(`Unhandled rejection: ${err && err.stack ? err.stack : err}`);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !isQuitting) app.quit();
});
