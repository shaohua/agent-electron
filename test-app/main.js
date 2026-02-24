const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Test App',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

// IPC handler to open second window
ipcMain.on('open-second-window', () => {
  const secondWindow = new BrowserWindow({
    width: 400,
    height: 300,
    title: 'Second Window',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  secondWindow.loadFile(path.join(__dirname, 'second.html'));
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
