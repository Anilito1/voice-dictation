const vscode = require("vscode");
const { spawn } = require("child_process");
const path = require("path");

let statusBar;
let backend = null;
let blinkTimer = null;
let state = "idle";
let sidebarProvider = null;
let apiKey = "";

// ── Storage helpers (globalState is reliable, secrets are not with junctions) ──
function loadApiKey(context) {
  return context.globalState.get("voiceDictation.apiKey", "");
}
async function saveApiKeyStore(context, key) {
  await context.globalState.update("voiceDictation.apiKey", key);
}
async function deleteApiKey(context) {
  await context.globalState.update("voiceDictation.apiKey", undefined);
}

function activate(context) {
  const extPath = context.extensionPath;

  // ── Status bar ────────────────────────────────────
  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right, 1000
  );
  statusBar.command = "voiceDictation.toggle";
  statusBar.show();

  // ── Sidebar webview ───────────────────────────────
  sidebarProvider = new SidebarProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("voiceDictation.panel", sidebarProvider)
  );

  // ── Commands ──────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("voiceDictation.toggle", () => {
      if (state === "recording") sendCommand({ cmd: "stop" });
      else if (state === "idle") sendCommand({ cmd: "start" });
    }),
    vscode.commands.registerCommand("voiceDictation.settings", () => {
      vscode.commands.executeCommand("voiceDictation.panel.focus");
    }),
    statusBar
  );

  // ── Load saved API key and start backend ──────────
  apiKey = loadApiKey(context);
  setIdle();
  if (apiKey) {
    spawnBackend(extPath);
  }
}

// ── Status bar states ──────────────────────────────────

function setIdle() {
  stopBlink();
  state = "idle";
  statusBar.text = "$(mic)";
  statusBar.tooltip = apiKey ? "Voice Dictation - Ready" : "Voice Dictation - Set API key in sidebar";
  statusBar.backgroundColor = undefined;
  statusBar.color = apiKey ? undefined : new vscode.ThemeColor("statusBarItem.warningForeground");
}

function setRecording() {
  state = "recording";
  statusBar.tooltip = "Recording... Click to stop";
  statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
  statusBar.color = new vscode.ThemeColor("statusBarItem.errorForeground");
  let on = true;
  stopBlink();
  blinkTimer = setInterval(() => {
    on = !on;
    statusBar.text = on ? "$(record) REC" : "$(mic) REC";
  }, 600);
}

function setProcessing() {
  stopBlink();
  state = "processing";
  statusBar.text = "$(loading~spin)";
  statusBar.tooltip = "Transcribing...";
  statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
  statusBar.color = new vscode.ThemeColor("statusBarItem.warningForeground");
}

function setDone() {
  stopBlink();
  state = "idle";
  statusBar.text = "$(check) OK";
  statusBar.tooltip = "Text pasted!";
  statusBar.backgroundColor = undefined;
  statusBar.color = "#2ecc71";
  setTimeout(() => { if (state === "idle") setIdle(); }, 2000);
}

function setError(msg) {
  stopBlink();
  state = "idle";
  statusBar.text = "$(error) ERR";
  statusBar.tooltip = msg || "Error";
  statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
  setTimeout(() => { if (state === "idle") setIdle(); }, 3000);
}

function stopBlink() {
  if (blinkTimer) { clearInterval(blinkTimer); blinkTimer = null; }
}

// ── Backend process ────────────────────────────────────

function spawnBackend(extPath) {
  if (backend && !backend.killed) {
    try { backend.kill(); } catch (e) {}
    backend = null;
  }
  if (!apiKey) return;

  const cfg = vscode.workspace.getConfiguration("voiceDictation");
  const pythonPath = cfg.get("pythonPath", "pythonw");
  const backendScript = path.join(extPath, "dictation_backend.py");

  backend = spawn(pythonPath, ["-u", backendScript], {
    cwd: extPath,
    env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buffer = "";
  backend.stdout.on("data", (data) => {
    buffer += data.toString("utf-8");
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try { handleMessage(JSON.parse(line)); } catch (e) {}
    }
  });

  let stderrBuf = "";
  backend.stderr.on("data", (data) => {
    stderrBuf += data.toString("utf-8");
    console.error("[VoiceDictation]", data.toString("utf-8").trim());
  });

  backend.on("error", (err) => {
    console.error("[VoiceDictation] spawn error:", err.message);
    backend = null;
    setError("Python not found");
    vscode.window.showErrorMessage(
      "Voice Dictation: Python not found. Install Python 3.10+ and set the path in settings.",
      "Open Settings"
    ).then(choice => {
      if (choice === "Open Settings") vscode.commands.executeCommand("workbench.action.openSettings", "voiceDictation.pythonPath");
    });
  });

  backend.on("close", (code) => {
    backend = null;
    if (stderrBuf.includes("ModuleNotFoundError") || stderrBuf.includes("No module named")) {
      autoInstallDeps(extPath);
      return;
    }
    if (state !== "idle") setError("Backend stopped");
    if (sidebarProvider) sidebarProvider.updateStatus("disconnected");
  });

  sendFullConfig();
}

function autoInstallDeps(extPath) {
  const reqFile = path.join(extPath, "requirements.txt");
  vscode.window.showInformationMessage(
    "Voice Dictation: Installing Python dependencies...",
  );
  if (sidebarProvider) sidebarProvider.updateStatus("disconnected");

  const cfg = vscode.workspace.getConfiguration("voiceDictation");
  // Use python (not pythonw) for pip install so it works
  let py = cfg.get("pythonPath", "pythonw");
  if (py === "pythonw") py = "python";
  if (py === "pythonw3") py = "python3";
  if (py.endsWith("pythonw.exe")) py = py.replace("pythonw.exe", "python.exe");

  const terminal = vscode.window.createTerminal("Voice Dictation Setup");
  terminal.show();
  terminal.sendText(py + ' -m pip install -r "' + reqFile + '"');
  terminal.sendText("echo.");
  terminal.sendText('echo Dependencies installed. Reload VS Code: Ctrl+Shift+P > Reload Window');

  vscode.window.showInformationMessage(
    "Voice Dictation: Installing dependencies in terminal. Reload VS Code when done.",
    "Reload Now"
  ).then(choice => {
    if (choice === "Reload Now") {
      vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
  });
}

function sendCommand(cmd) {
  if (!backend || backend.killed) {
    if (!apiKey) {
      vscode.window.showWarningMessage("Voice Dictation: Set your API key in the sidebar first.");
      vscode.commands.executeCommand("voiceDictation.panel.focus");
      return;
    }
    spawnBackend(path.resolve(__dirname, ".."));
    setTimeout(() => sendCommand(cmd), 1000);
    return;
  }
  try {
    backend.stdin.write(JSON.stringify(cmd) + "\n");
  } catch (e) {
    console.error("[VoiceDictation] stdin write error:", e.message);
  }
}

function sendFullConfig() {
  const cfg = vscode.workspace.getConfiguration("voiceDictation");
  sendCommand({
    cmd: "config",
    apiKey: apiKey,
    language: cfg.get("language", "fr"),
    silenceDuration: cfg.get("silenceDuration", 1.5),
    maxDuration: cfg.get("maxDuration", 120),
    silenceThreshold: cfg.get("silenceThreshold", 0.01),
    hotkeyScancode: cfg.get("hotkeyScancode", 41),
    hotkeyCtrl: cfg.get("hotkeyCtrl", false),
    hotkeyAlt: cfg.get("hotkeyAlt", false),
    hotkeyShift: cfg.get("hotkeyShift", false),
  });
}

// ── Handle messages from backend ───────────────────────

function handleMessage(msg) {
  switch (msg.status) {
    case "ready":
      if (sidebarProvider) sidebarProvider.updateStatus("connected");
      break;
    case "recording":
      setRecording();
      if (sidebarProvider) sidebarProvider.updateStatus("recording");
      break;
    case "processing":
      setProcessing();
      if (sidebarProvider) sidebarProvider.updateStatus("processing");
      break;
    case "done":
      setDone();
      if (sidebarProvider) sidebarProvider.updateStatus("done", msg.text);
      break;
    case "error":
      setError(msg.msg);
      vscode.window.showErrorMessage("Voice Dictation: " + msg.msg);
      if (sidebarProvider) sidebarProvider.updateStatus("error", msg.msg);
      break;
    case "skip":
      setIdle();
      if (sidebarProvider) sidebarProvider.updateStatus("connected");
      break;
    case "capturing":
      if (sidebarProvider) sidebarProvider.updateStatus("capturing");
      break;
    case "key_captured":
      if (sidebarProvider) sidebarProvider.updateStatus("key_captured", JSON.stringify({ scancode: msg.scancode, name: msg.name }));
      break;
  }
}

// ── Sidebar panel provider ─────────────────────────────

class SidebarProvider {
  constructor(context) {
    this._context = context;
    this._view = null;
  }

  _rebuildHtml() {
    if (!this._view) return;
    apiKey = loadApiKey(this._context);
    const cfg = vscode.workspace.getConfiguration("voiceDictation");
    const s = {
      language: cfg.get("language", "fr"),
      hotkeyScancode: cfg.get("hotkeyScancode", 41),
      hotkeyName: cfg.get("hotkeyName", ""),
      hotkeyCtrl: cfg.get("hotkeyCtrl", false),
      hotkeyAlt: cfg.get("hotkeyAlt", false),
      hotkeyShift: cfg.get("hotkeyShift", false),
      silenceDuration: cfg.get("silenceDuration", 1.5),
      maxDuration: cfg.get("maxDuration", 120),
      silenceThreshold: cfg.get("silenceThreshold", 0.01),
      hasKey: !!apiKey,
      connected: !!(backend && !backend.killed),
    };
    this._view.webview.html = buildSidebarHtml(s);
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };

    // Rebuild HTML now
    this._rebuildHtml();

    // Rebuild when panel becomes visible again (user navigated away and back)
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this._rebuildHtml();
      }
    });

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "saveApiKey") {
        apiKey = msg.key;
        await saveApiKeyStore(this._context, msg.key);
        spawnBackend(this._context.extensionPath);
        setIdle();
        // Rebuild sidebar to show connected state from storage
        setTimeout(() => this._rebuildHtml(), 300);
      } else if (msg.type === "removeApiKey") {
        apiKey = "";
        await deleteApiKey(this._context);
        if (backend && !backend.killed) {
          try { backend.stdin.write(JSON.stringify({ cmd: "quit" }) + "\n"); } catch (e) {}
          setTimeout(() => { try { if (backend) backend.kill(); } catch(e) {} backend = null; }, 500);
        }
        setIdle();
        // Rebuild sidebar to show disconnected state from storage
        setTimeout(() => this._rebuildHtml(), 300);
      } else if (msg.type === "captureKey") {
        sendCommand({ cmd: "capture_key" });
      } else if (msg.type === "saveSettings") {
        const c = vscode.workspace.getConfiguration("voiceDictation");
        if (msg.language !== undefined) await c.update("language", msg.language, vscode.ConfigurationTarget.Global);
        if (msg.hotkeyScancode !== undefined) await c.update("hotkeyScancode", msg.hotkeyScancode, vscode.ConfigurationTarget.Global);
        if (msg.hotkeyName !== undefined) await c.update("hotkeyName", msg.hotkeyName, vscode.ConfigurationTarget.Global);
        if (msg.hotkeyCtrl !== undefined) await c.update("hotkeyCtrl", msg.hotkeyCtrl, vscode.ConfigurationTarget.Global);
        if (msg.hotkeyAlt !== undefined) await c.update("hotkeyAlt", msg.hotkeyAlt, vscode.ConfigurationTarget.Global);
        if (msg.hotkeyShift !== undefined) await c.update("hotkeyShift", msg.hotkeyShift, vscode.ConfigurationTarget.Global);
        if (msg.silenceDuration !== undefined) await c.update("silenceDuration", msg.silenceDuration, vscode.ConfigurationTarget.Global);
        if (msg.maxDuration !== undefined) await c.update("maxDuration", msg.maxDuration, vscode.ConfigurationTarget.Global);
        if (msg.silenceThreshold !== undefined) await c.update("silenceThreshold", msg.silenceThreshold, vscode.ConfigurationTarget.Global);
        sendFullConfig();
      } else if (msg.type === "toggle") {
        vscode.commands.executeCommand("voiceDictation.toggle");
      }
    });
  }

  updateStatus(status, detail) {
    if (this._view && this._view.webview) {
      this._view.webview.postMessage({ type: "status", status, detail });
    }
  }
}

// ── Sidebar HTML ───────────────────────────────────────

function buildSidebarHtml(s) {
  const KEYS = {
    1:"Echap", 2:"1", 3:"2", 4:"3", 5:"4", 6:"5", 7:"6", 8:"7", 9:"8", 10:"9", 11:"0",
    14:"Retour", 15:"Tab", 16:"A", 17:"Z", 18:"E", 19:"R", 20:"T", 21:"Y", 22:"U",
    23:"I", 24:"O", 25:"P", 28:"Entree", 29:"Ctrl", 30:"Q", 31:"S", 32:"D", 33:"F",
    34:"G", 35:"H", 36:"J", 37:"K", 38:"L", 39:"M", 41:"\u00b2", 42:"Shift",
    44:"W", 45:"X", 46:"C", 47:"V", 48:"B", 49:"N", 56:"Alt", 57:"Espace",
    58:"Verr Maj", 59:"F1", 60:"F2", 61:"F3", 62:"F4", 63:"F5", 64:"F6",
    65:"F7", 66:"F8", 67:"F9", 68:"F10", 87:"F11", 88:"F12", 70:"Arr Defil",
    91:"Win", 100:"Alt Gr", 111:"Suppr"
  };
  const keyName = s.hotkeyName || KEYS[s.hotkeyScancode] || ("Scancode " + s.hotkeyScancode);

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
  '*{box-sizing:border-box;margin:0;padding:0}' +
  'body{font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-foreground);padding:12px}' +
  'h2{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--vscode-descriptionForeground);margin:18px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--vscode-widget-border)}' +
  'h2:first-child{margin-top:4px}' +
  '.status{display:flex;align-items:center;gap:8px;padding:10px;border-radius:6px;margin-bottom:12px;background:var(--vscode-editor-background);border:1px solid var(--vscode-widget-border)}' +
  '.dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}' +
  '.dot.off{background:#666}.dot.on{background:#2ecc71}.dot.rec{background:#e74c3c;animation:bl 1s infinite}.dot.proc{background:#f39c12;animation:bl .5s infinite}' +
  '@keyframes bl{0%,100%{opacity:1}50%{opacity:.3}}' +
  '.mic-btn{width:100%;padding:10px;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}' +
  '.mic-btn:hover{background:var(--vscode-button-hoverBackground)}.mic-btn.rec{background:#c0392b;color:white}' +
  'label{display:block;font-size:12px;margin-bottom:4px;color:var(--vscode-descriptionForeground)}' +
  'input,select{width:100%;padding:6px 8px;border-radius:4px;font-size:12px;margin-bottom:10px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);outline:none}' +
  'input:focus,select:focus{border-color:var(--vscode-focusBorder)}' +
  'input[type=range]{padding:0;border:none;background:transparent}' +
  '.row{display:flex;align-items:center;gap:8px}.row input{flex:1}.row span{min-width:32px;font-size:12px;text-align:right;font-weight:600;color:var(--vscode-textLink-foreground)}' +
  '.btn{width:100%;padding:7px;border:none;border-radius:4px;font-size:12px;cursor:pointer;margin-bottom:6px;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}.btn:hover{background:var(--vscode-button-hoverBackground)}' +

  // API key connected line
  '.api-line{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;margin-bottom:10px;background:var(--vscode-editor-background);border:1px solid #2ecc71}' +
  '.api-line .adot{width:8px;height:8px;border-radius:50%;background:#2ecc71;flex-shrink:0}' +
  '.api-line .albl{flex:1;font-size:12px;font-weight:600}' +
  '.api-line .adel{background:none;border:none;color:var(--vscode-descriptionForeground);cursor:pointer;font-size:14px;padding:2px 6px;border-radius:4px}' +
  '.api-line .adel:hover{color:#e74c3c;background:rgba(231,76,60,.15)}' +

  // Modal
  '.modal-bg{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:100;align-items:center;justify-content:center}' +
  '.modal-bg.show{display:flex}' +
  '.modal{background:var(--vscode-editor-background);border:1px solid var(--vscode-widget-border);border-radius:8px;padding:16px;width:90%;max-width:260px;text-align:center}' +
  '.modal p{font-size:13px;margin-bottom:14px}.modal-row{display:flex;gap:8px}' +
  '.modal-row button{flex:1;padding:7px;border:none;border-radius:4px;font-size:12px;cursor:pointer}' +
  '.mbtn-cancel{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}' +
  '.mbtn-del{background:#e74c3c;color:white}' +

  '.desc{font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:8px;line-height:1.4}' +
  '.key-btn{background:var(--vscode-editor-background);border:1px solid var(--vscode-widget-border);border-radius:6px;padding:12px;text-align:center;cursor:pointer;margin-bottom:8px;transition:border-color .2s}' +
  '.key-btn:hover{border-color:var(--vscode-focusBorder)}' +
  '.key-btn .current{font-family:Consolas,monospace;font-size:15px;font-weight:700;color:var(--vscode-textLink-foreground)}' +
  '.key-btn .sub{font-size:10px;color:var(--vscode-descriptionForeground);margin-top:4px}' +
  '.key-btn.listening{border-color:#e74c3c}.key-btn.listening .current{color:#e74c3c;animation:bl 1s infinite}' +
  '.toast{position:fixed;bottom:12px;left:12px;right:12px;padding:8px 12px;border-radius:6px;font-size:12px;text-align:center;background:var(--vscode-button-background);color:var(--vscode-button-foreground);opacity:0;transition:opacity .3s;pointer-events:none;z-index:10}.toast.show{opacity:1}' +
  '</style></head><body>' +

  '<div class="status" id="statusBox"><div class="dot ' + (s.connected ? 'on' : 'off') + '" id="dot"></div>' +
  '<span id="statusText">' + (s.connected ? 'Connected' : (s.hasKey ? 'Connecting...' : 'No API key')) + '</span></div>' +

  '<button class="mic-btn" id="micBtn" onclick="toggle()"><span id="micLabel">Press to record</span></button>' +

  '<h2>API Key</h2>' +
  '<div id="keySection">' +
  (s.hasKey
    ? '<div class="api-line"><span class="adot"></span><span class="albl">Connected</span>' +
      '<button class="adel" onclick="confirmDel()" title="Remove key">&#x2715;</button></div>'
    : '<label>Enter your API key</label><input type="password" id="apiKeyInput" placeholder="Your API key..." />' +
      '<button class="btn" onclick="saveKey()">Connect</button>'
  ) + '</div>' +

  '<div class="modal-bg" id="modal"><div class="modal"><p>Remove your API key?</p>' +
  '<div class="modal-row"><button class="mbtn-cancel" onclick="closeDel()">Cancel</button>' +
  '<button class="mbtn-del" onclick="doRemove()">Remove</button></div></div></div>' +

  '<h2>Bind your shortcut</h2>' +
  '<div class="key-btn" id="keyBtn"><div class="current" id="keyLabel">' + keyName + '</div>' +
  '<div class="sub">Click to change</div></div>' +
  '<div style="display:flex;gap:10px;margin-bottom:12px">' +
    '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="checkbox" id="modCtrl"' + (s.hotkeyCtrl ? ' checked' : '') + ' onchange="saveMods()"> Ctrl</label>' +
    '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="checkbox" id="modAlt"' + (s.hotkeyAlt ? ' checked' : '') + ' onchange="saveMods()"> Alt</label>' +
    '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px"><input type="checkbox" id="modShift"' + (s.hotkeyShift ? ' checked' : '') + ' onchange="saveMods()"> Shift</label>' +
  '</div>' +
  '<input type="hidden" id="scancode" value="' + s.hotkeyScancode + '">' +
  '<input type="hidden" id="keyNameVal" value="' + (s.hotkeyName || keyName).replace(/"/g, '&quot;') + '">' +

  '<h2>Language</h2>' +
  '<select id="lang" onchange="saveSettings()">' +
  buildOptions([["fr","Fran\u00e7ais"],["en","English"],["es","Espa\u00f1ol"],["de","Deutsch"],["it","Italiano"],["pt","Portugu\u00eas"],["nl","Nederlands"],["ja","Japanese"],["ko","Korean"],["zh","Chinese"]], s.language) +
  '</select>' +

  '<h2>Voice Detection</h2>' +
  '<label>Auto-stop after silence</label>' +
  '<div class="row"><input type="range" id="sd" min="0.5" max="5" step="0.5" value="' + s.silenceDuration + '" oninput="updSD()" onchange="saveSettings()"><span id="sdv">' + s.silenceDuration + 's</span></div>' +
  '<label>Max recording (sec)</label><input type="number" id="md" min="5" max="600" value="' + s.maxDuration + '" onchange="saveSettings()" />' +
  '<label>Silence sensitivity</label>' +
  '<div class="row"><input type="range" id="st" min="0.001" max="0.1" step="0.001" value="' + s.silenceThreshold + '" oninput="updST()" onchange="saveSettings()"><span id="stv">' + s.silenceThreshold + '</span></div>' +
  '<div class="desc">How quiet it needs to be to count as silence. Lower = more sensitive, higher = needs more silence to auto-stop.</div>' +

  '<div class="toast" id="toast"></div>' +

  '<script>' +
  'const vsc=acquireVsCodeApi();' +

  'const keyBtn=document.getElementById("keyBtn"),keyLabel=document.getElementById("keyLabel");' +
  'keyBtn.addEventListener("click",()=>{keyBtn.classList.add("listening");keyLabel.textContent="Press any key...";vsc.postMessage({type:"captureKey"});});' +

  'window.addEventListener("message",e=>{const m=e.data;if(m.type!=="status")return;' +
  'const d=document.getElementById("dot"),t=document.getElementById("statusText"),b=document.getElementById("micBtn"),l=document.getElementById("micLabel");d.className="dot ";' +
  'switch(m.status){' +
  'case"connected":d.classList.add("on");t.textContent="Connected";b.className="mic-btn";l.textContent="Press to record";break;' +
  'case"disconnected":d.classList.add("off");t.textContent="Disconnected";b.className="mic-btn";l.textContent="Set API key first";break;' +
  'case"connecting":d.classList.add("off");t.textContent="Connecting...";break;' +
  'case"recording":d.classList.add("rec");t.textContent="Recording...";b.className="mic-btn rec";l.textContent="Click to stop";break;' +
  'case"processing":d.classList.add("proc");t.textContent="Transcribing...";b.className="mic-btn";l.textContent="Transcribing...";break;' +
  'case"done":d.classList.add("on");t.textContent=(m.detail||"").substring(0,40);b.className="mic-btn";l.textContent="Press to record";break;' +
  'case"error":d.classList.add("off");t.textContent="Error";b.className="mic-btn";l.textContent="Press to record";break;' +
  'case"capturing":break;' +
  'case"key_captured":try{var kd=JSON.parse(m.detail);document.getElementById("scancode").value=kd.scancode;' +
  'document.getElementById("keyNameVal").value=kd.name;document.getElementById("keyLabel").textContent=kd.name;' +
  'document.getElementById("keyBtn").classList.remove("listening");' +
  'vsc.postMessage({type:"saveSettings",hotkeyScancode:kd.scancode,hotkeyName:kd.name,' +
  'hotkeyCtrl:document.getElementById("modCtrl").checked,' +
  'hotkeyAlt:document.getElementById("modAlt").checked,' +
  'hotkeyShift:document.getElementById("modShift").checked});' +
  'toast("Shortcut: "+kd.name);}catch(ex){}break;' +
  '}});' +

  'function toggle(){vsc.postMessage({type:"toggle"});}' +

  'function saveMods(){vsc.postMessage({type:"saveSettings",' +
  'hotkeyScancode:parseInt(document.getElementById("scancode").value),' +
  'hotkeyName:document.getElementById("keyNameVal").value,' +
  'hotkeyCtrl:document.getElementById("modCtrl").checked,' +
  'hotkeyAlt:document.getElementById("modAlt").checked,' +
  'hotkeyShift:document.getElementById("modShift").checked});toast("Saved!");}' +

  'function saveKey(){var k=document.getElementById("apiKeyInput");if(!k||!k.value.trim())return;' +
  'vsc.postMessage({type:"saveApiKey",key:k.value.trim()});' +
  'document.getElementById("keySection").innerHTML=\'<div class="api-line"><span class="adot"></span><span class="albl">Connected</span>' +
  '<button class="adel" onclick="confirmDel()" title="Remove key">\\u2715</button></div>\';toast("API key saved!");}' +

  'function confirmDel(){document.getElementById("modal").classList.add("show");}' +
  'function closeDel(){document.getElementById("modal").classList.remove("show");}' +
  'function doRemove(){closeDel();vsc.postMessage({type:"removeApiKey"});' +
  'document.getElementById("keySection").innerHTML=\'<label>Enter your API key</label><input type="password" id="apiKeyInput" placeholder="Your API key..." />' +
  '<button class="btn" onclick="saveKey()">Connect</button>\';toast("Key removed");}' +

  'function saveSettings(){vsc.postMessage({type:"saveSettings",language:document.getElementById("lang").value,' +
  'hotkeyScancode:parseInt(document.getElementById("scancode").value),' +
  'silenceDuration:parseFloat(document.getElementById("sd").value),' +
  'maxDuration:parseInt(document.getElementById("md").value),' +
  'silenceThreshold:parseFloat(document.getElementById("st").value)});toast("Saved!");}' +

  'function updSD(){document.getElementById("sdv").textContent=document.getElementById("sd").value+"s";}' +
  'function updST(){document.getElementById("stv").textContent=parseFloat(document.getElementById("st").value).toFixed(3);}' +
  'function toast(m){var t=document.getElementById("toast");t.textContent=m;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),1500);}' +
  '</script></body></html>';
}

function buildOptions(opts, selected) {
  return opts.map(([v, l]) => '<option value="' + v + '"' + (v === selected ? ' selected' : '') + '>' + l + '</option>').join('');
}

function deactivate() {
  stopBlink();
  if (backend && !backend.killed) {
    try { backend.stdin.write(JSON.stringify({ cmd: "quit" }) + "\n"); } catch (e) {}
    setTimeout(() => { try { if (backend) backend.kill(); } catch(e) {} }, 1000);
  }
}

module.exports = { activate, deactivate };
