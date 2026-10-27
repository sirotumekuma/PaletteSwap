const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("textureStudio", {
  listTextures: () => ipcRenderer.invoke("list-textures"),
  readTexture: filename => ipcRenderer.invoke("read-texture", filename),
  saveFile: ({ filename, data }) =>
    ipcRenderer.invoke("save-file", { filename, data }),
  saveProject: contents => ipcRenderer.invoke("save-project", contents),
  openProject: () => ipcRenderer.invoke("open-project"),
  onOpenProjectFile: callback => {
    const listener = (_event, project) => callback(project);
    ipcRenderer.on("open-project-file", listener);
    return () => ipcRenderer.removeListener("open-project-file", listener);
  },
  onOpenProjectError: callback => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("open-project-error", listener);
    return () => ipcRenderer.removeListener("open-project-error", listener);
  },
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  onUpdateStatus: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.removeListener("update-status", listener);
  }
});
