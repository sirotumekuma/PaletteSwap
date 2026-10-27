const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs/promises");
const path = require("node:path");

const textureDirectory = path.join(__dirname, "textures");
let mainWindow;
let updateDownloaded = false;
let pendingProjectPath = process.argv.find(argument =>
  argument.toLowerCase().endsWith(".psproj")
);
const hasSingleInstanceLock = app.requestSingleInstanceLock();

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

ipcMain.handle("save-project", async (event, contents) => {
  if (typeof contents !== "string") {
    throw new TypeError("プロジェクトのデータが正しくありません。");
  }
  if (Buffer.byteLength(contents, "utf8") > 20 * 1024 * 1024) {
    throw new RangeError("プロジェクトファイルが大きすぎます。");
  }

  const owner = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(owner, {
    defaultPath: "無題.psproj",
    filters: [{ name: "PaletteSwap プロジェクト", extensions: ["psproj"] }]
  });
  if (canceled || !filePath) return { canceled: true };

  const projectPath = filePath.toLowerCase().endsWith(".psproj")
    ? filePath
    : `${filePath}.psproj`;
  await fs.writeFile(projectPath, contents, "utf8");
  return { canceled: false };
});

ipcMain.handle("open-project", async event => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(owner, {
    properties: ["openFile"],
    filters: [{ name: "PaletteSwap プロジェクト", extensions: ["psproj"] }]
  });
  if (canceled || !filePaths[0]) return { canceled: true };

  const filePath = filePaths[0];
  return { canceled: false, ...await readProjectFile(filePath) };
});

async function readProjectFile(filePath) {
  if (!filePath.toLowerCase().endsWith(".psproj")) {
    throw new TypeError("PaletteSwapプロジェクト（.psproj）を選択してください。");
  }
  const stats = await fs.stat(filePath);
  if (stats.size > 20 * 1024 * 1024) {
    throw new RangeError("プロジェクトファイルが大きすぎます。");
  }
  return {
    filename: path.basename(filePath),
    contents: await fs.readFile(filePath, "utf8")
  };
}

async function openProjectFromPath(filePath) {
  try {
    const project = await readProjectFile(filePath);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("open-project-file", project);
    }
  } catch (error) {
    console.error("プロジェクトを開けませんでした:", error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("open-project-error", error.message);
    }
  }
}

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
  window.webContents.once("did-finish-load", () => {
    if (pendingProjectPath) {
      const filePath = pendingProjectPath;
      pendingProjectPath = null;
      openProjectFromPath(filePath);
    }
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.loadFile(path.join(__dirname, "マイクラ テクスチャ工房.html"));
}

if (hasSingleInstanceLock) {
  app.on("second-instance", (_event, argv) => {
    const projectPath = argv.find(argument =>
      argument.toLowerCase().endsWith(".psproj")
    );
    if (projectPath) {
      if (mainWindow && !mainWindow.webContents.isLoading()) {
        openProjectFromPath(projectPath);
      } else {
        pendingProjectPath = projectPath;
      }
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
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
