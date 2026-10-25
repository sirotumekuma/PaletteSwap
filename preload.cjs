const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("textureStudio", {
  listTextures: () => ipcRenderer.invoke("list-textures"),
  readTexture: filename => ipcRenderer.invoke("read-texture", filename),
  saveFile: ({ filename, data }) =>
    ipcRenderer.invoke("save-file", { filename, data }),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  onUpdateStatus: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.removeListener("update-status", listener);
  }
});
