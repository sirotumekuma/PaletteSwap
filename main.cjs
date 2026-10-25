const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs/promises");
const path = require("node:path");

const textureDirectory = path.join(__dirname, "textures");
let mainWindow;
let updateDownloaded = false;

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function sendUpdateStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update-status", status);
  }
}

autoUpdater.on("checking-for-update", () => {
  sendUpdateStatus({ state: "checking" });
});
autoUpdater.on("update-available", info => {
  sendUpdateStatus({ state: "available", version: info.version });
});
autoUpdater.on("update-not-available", info => {
  sendUpdateStatus({ state: "current", version: info.version });
});
autoUpdater.on("download-progress", progress => {
  sendUpdateStatus({
    state: "downloading",
    percent: Math.round(progress.percent)
  });
});
autoUpdater.on("update-downloaded", info => {
  updateDownloaded = true;
  sendUpdateStatus({ state: "downloaded", version: info.version });
});
autoUpdater.on("error", error => {
  console.error("自動更新に失敗しました:", error);
  sendUpdateStatus({ state: "error", message: error.message });
});

async function checkForUpdates() {
  if (!app.isPackaged) {
    sendUpdateStatus({ state: "development" });
    return;
  }
  await autoUpdater.checkForUpdates();
}

ipcMain.handle("check-for-updates", async () => {
  try {
    await checkForUpdates();
  } catch (error) {
    console.error("更新の確認に失敗しました:", error);
    sendUpdateStatus({ state: "error", message: error.message });
    throw error;
  }
});

ipcMain.handle("install-update", () => {
  if (!updateDownloaded) {
    throw new Error("更新ファイルのダウンロードが完了していません。");
  }
  autoUpdater.quitAndInstall();
});

async function listPngTextures(directory = textureDirectory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listPngTextures(absolutePath);
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".png")) return [];
    return [path.relative(__dirname, absolutePath).split(path.sep).join("/")];
  }));
  return files.flat().sort((a, b) => a.localeCompare(b));
}

ipcMain.handle("list-textures", async () => {
  return listPngTextures();
});

ipcMain.handle("read-texture", async (_event, filename) => {
  if (
    typeof filename !== "string" ||
    filename.includes("\0") ||
    path.isAbsolute(filename) ||
    !filename.toLowerCase().endsWith(".png")
  ) {
    throw new TypeError("テクスチャのパスが正しくありません。");
  }
  const absolutePath = path.resolve(__dirname, filename);
  const relativePath = path.relative(textureDirectory, absolutePath);
  if (
    relativePath === "" ||
    relativePath.startsWith(`..${path.sep}`) ||
    relativePath === ".." ||
    path.isAbsolute(relativePath)
  ) {
    throw new TypeError("テクスチャは素材フォルダー内から選択してください。");
  }
  return new Uint8Array(await fs.readFile(absolutePath));
});

ipcMain.handle("save-file", async (event, { filename, data } = {}) => {
  if (typeof filename !== "string" || path.basename(filename) !== filename) {
    throw new TypeError("ファイル名が正しくありません。");
  }
  if (!(data instanceof Uint8Array)) {
    throw new TypeError("保存するデータが正しくありません。");
  }

  const owner = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(owner, {
    defaultPath: filename,
    filters: [{ name: "PNG / ZIP", extensions: ["png", "zip"] }]
  });
  if (canceled || !filePath) return { canceled: true };

  await fs.writeFile(filePath, data);
  return { canceled: false };
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 900,
    minHeight: 700,
    title: "Palette-Swap",
    icon: path.join(__dirname, "favicon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.loadFile(path.join(__dirname, "マイクラ テクスチャ工房.html"));
}

app.whenReady().then(() => {
  createWindow();
  if (app.isPackaged) {
    setTimeout(() => {
      checkForUpdates().catch(error => {
        console.error("起動時の更新確認に失敗しました:", error);
      });
    }, 5000);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
