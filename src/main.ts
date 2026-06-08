import { invoke, Channel } from "@tauri-apps/api/core";

/* ===========================================================================
   Types (snake_case to match the Rust serde output)
   =========================================================================== */

interface EnvStatus {
  python_ok: boolean;
  python_version: string | null;
  git_ok: boolean;
  smbclient_ok: boolean;
  sshpass_ok: boolean;
  brew_ok: boolean;
  checkout_present: boolean;
  venv_present: boolean;
  env_present: boolean;
  checkout_path: string;
}

interface DeviceInfo {
  name: string;
  hostname: string;
  ipv4: string[];
  host: string;
  model: string | null;
  is_airport: boolean;
}

interface DoctorResult {
  status: string;
  message: string;
}

interface DoctorReport {
  fatal: boolean;
  summary: string;
  results: DoctorResult[];
}

interface LogLine {
  stream: string;
  line: string;
}

/* ===========================================================================
   Environment / demo fallback
   =========================================================================== */

const TAURI =
  typeof (window as never as { __TAURI_INTERNALS__?: unknown })
    .__TAURI_INTERNALS__ !== "undefined";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DEMO_ENV: EnvStatus = {
  python_ok: true,
  python_version: "3.9.6",
  git_ok: true,
  smbclient_ok: false,
  sshpass_ok: false,
  brew_ok: false,
  checkout_present: false,
  venv_present: false,
  env_present: false,
  checkout_path:
    "~/Library/Application Support/com.czaple.timecapsulesmb/TimeCapsuleSMB",
};

const DEMO_DEVICES: DeviceInfo[] = [
  {
    name: "Time Capsule de Thomas",
    hostname: "Time-Capsule-de-Thomas.local",
    ipv4: ["169.254.104.16", "192.168.1.50"],
    host: "192.168.1.50",
    model: "AirPort10,115 (Time Capsule Gen 5)",
    is_airport: true,
  },
  {
    name: "MacBook Pro",
    hostname: "MacBook-Pro.local",
    ipv4: ["192.168.1.22"],
    host: "192.168.1.22",
    model: null,
    is_airport: false,
  },
];

const DEMO_SETUP = [
  "Cloning into 'TimeCapsuleSMB'...",
  "remote: Enumerating objects: 1284, done.",
  "Receiving objects: 100% (1284/1284), 4.21 MiB | 6.02 MiB/s, done.",
  "Creating virtualenv at .venv",
  "Collecting zeroconf>=0.132.2",
  "Collecting pexpect>=4.9.0",
  "Successfully installed zeroconf ifaddr pexpect pycryptodome",
  "Bootstrap complete.",
];

const DEMO_BREW_SSHPASS = [
  "==> Tapping esolitos/ipa",
  "==> Downloading sshpass-1.10.tar.gz",
  "==> Installing sshpass from esolitos/ipa",
  "🍺  /opt/homebrew/Cellar/sshpass/1.10: 8 files, 48KB",
];

const DEMO_BREW_SAMBA = [
  "==> Downloading https://ghcr.io/v2/homebrew/core/samba/manifests/4.x",
  "==> Fetching dependencies for samba",
  "==> Installing samba",
  "==> Pouring samba--4.x.arm64.bottle.tar.gz",
  "🍺  /opt/homebrew/Cellar/samba/4.x: 1,234 files, 42MB",
];

const DEMO_SSH = [
  "Checking SSH on Time-Capsule-de-Thomas.local:22 ...",
  "SSH is closed. Attempting to enable via ACP...",
  "ACP: setting dbug flag, rebooting device...",
  "Waiting for the Time Capsule to come back (this can take a few minutes)...",
  "SSH is now reachable.",
  "SSH enabled successfully.",
];

const DEMO_DEPLOY = [
  "Resolving deployment target...",
  "Validating local artifacts...",
  "Checking device compatibility...",
  "Using NetBSD6 payload.",
  "Finding payload volume...",
  "Stopping existing runtime...",
  "Uploading deployment payload...",
  "Uploaded smbd.",
  "Uploaded mdns-advertiser.",
  "Uploaded nbns-advertiser.",
  "Uploaded boot files.",
  "Uploaded runtime config.",
  "Uploaded Samba account files.",
  "Upload phase complete.",
  "Applying file permissions...",
  "Verifying uploaded payload...",
  "Requesting reboot...",
  "Waiting for managed runtime to finish starting...",
  "Deploy Finished.",
];

const DEMO_DOCTOR: DoctorReport = {
  fatal: false,
  summary: "doctor checks passed.",
  results: [
    { status: "PASS", message: "Local tools available (ssh, scp)." },
    { status: "PASS", message: "Config valid (TC_HOST, TC_PASSWORD)." },
    { status: "PASS", message: "SSH login to Time Capsule succeeded." },
    {
      status: "PASS",
      message: "Managed smbd is running and bound to port 445.",
    },
    { status: "PASS", message: "Bonjour advertises the SMB share." },
    { status: "PASS", message: "Authenticated SMB listing succeeded." },
    {
      status: "WARN",
      message: "smbclient not found locally; skipped extra file test.",
    },
    { status: "INFO", message: "Advertised host: Time-Capsule-de-Thomas.local" },
  ],
};

const DEMO_ACTIVATE = [
  "Resolving deployment target...",
  "Restarting deployed Samba services on the device...",
  "Managed smbd is running and bound to port 445.",
  "NetBSD4 activation complete. Re-run after each reboot.",
];

const DEMO_FLASH_CHECK = [
  "Reading active firmware bank...",
  "Active bank matches Apple stock firmware.",
];

const DEMO_FLASH_BACKUP = [
  "Dumping firmware bank 0...",
  "Dumping firmware bank 1...",
  "Backup saved to firmware-backup/.",
];

const DEMO_FLASH_PATCH = [
  "Backing up active firmware bank...",
  "Patching LOGIN hook in primary bank...",
  "Verifying patched bank...",
  "Patch write successful. Power-cycle the device manually.",
];

/* invoke wrapper that falls back to demo data in a browser. */
async function call<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (TAURI) return invoke<T>(cmd, args);
  await sleep(450);
  switch (cmd) {
    case "check_env":
      return DEMO_ENV as unknown as T;
    case "discover":
      return DEMO_DEVICES as unknown as T;
    case "save_config":
      return (DEMO_ENV.checkout_path + "/.env") as unknown as T;
    case "doctor":
      return DEMO_DOCTOR as unknown as T;
    case "install_xcode_clt":
      return "Les outils Xcode sont déjà installés (démo)." as unknown as T;
    case "install_homebrew":
      DEMO_ENV.brew_ok = true;
      return "Terminal lancé (démo). Clique « Revérifier »." as unknown as T;
    default:
      return undefined as unknown as T;
  }
}

/* Streamed command: real Channel under Tauri, scripted lines in demo mode. */
async function stream(
  cmd: string,
  onLine: (l: LogLine) => void,
  demoLines: string[],
): Promise<number> {
  if (TAURI) {
    const channel = new Channel<LogLine>();
    channel.onmessage = (m) => onLine(m);
    return await invoke<number>(cmd, { onEvent: channel });
  }
  for (const line of demoLines) {
    onLine({ stream: "stdout", line });
    await sleep(130);
  }
  if (cmd === "install_sshpass") DEMO_ENV.sshpass_ok = true;
  if (cmd === "install_smbclient") DEMO_ENV.smbclient_ok = true;
  onLine({ stream: "status", line: "__exit__:0" });
  return 0;
}

/* ===========================================================================
   App state
   =========================================================================== */

type StepState = "idle" | "running" | "done" | "error";

const state = {
  current: 0,
  maxUnlocked: 0,
  env: null as EnvStatus | null,
  prep: "idle" as StepState,
  devices: [] as DeviceInfo[],
  discovering: false,
  host: "",
  smbHost: "",
  password: "",
  useDiskRoot: false,
  anyProtocol: false,
  deviceSaved: false,
  ssh: "idle" as StepState,
  install: "idle" as StepState,
  deviceFamily: null as "netbsd4" | "netbsd6" | null,
  doctor: null as DoctorReport | null,
  doctorRunning: false,
};

const STEPS = [
  { label: "Préparation" },
  { label: "Time Capsule" },
  { label: "Activer SSH" },
  { label: "Installation" },
  { label: "Terminé" },
];

/* ===========================================================================
   Small helpers
   =========================================================================== */

const byId = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

function unlock(step: number) {
  if (step > state.maxUnlocked) state.maxUnlocked = step;
}

const ICONS = {
  check: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>`,
  checkBig: `<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>`,
  ok: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>`,
  x: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  search: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5"/></svg>`,
  info: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>`,
  warn: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9.5 16.5H2.5L12 3z"/><path d="M12 10v4M12 17h.01"/></svg>`,
  capsule: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6"/><path d="M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3"/></svg>`,
  finder: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V5a2 2 0 0 1 2-2h7l5 5v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M14 3v5h5"/></svg>`,
};

function spinner() {
  return `<span class="spinner"></span>`;
}

/* ===========================================================================
   Sidebar
   =========================================================================== */

function stepDone(i: number): boolean {
  if (i === 0) return state.prep === "done";
  if (i === 1) return state.deviceSaved;
  if (i === 2) return state.ssh === "done";
  if (i === 3) return state.install === "done";
  if (i === 4) return state.doctor != null && !state.doctor.fatal;
  return false;
}

function renderSidebar() {
  const nav = byId<HTMLElement>("steps");
  nav.innerHTML = STEPS.map((s, i) => {
    const active = i === state.current ? "active" : "";
    const done = stepDone(i) ? "done" : "";
    const locked = i > state.maxUnlocked ? "locked" : "";
    const badge = stepDone(i) ? ICONS.check : String(i + 1);
    return `<div class="step ${active} ${done} ${locked}" data-i="${i}">
      <div class="step-index">${badge}</div>
      <div class="step-label">${s.label}</div>
    </div>`;
  }).join("");

  nav.querySelectorAll<HTMLElement>(".step").forEach((el) => {
    el.addEventListener("click", () => {
      const i = Number(el.dataset.i);
      if (i <= state.maxUnlocked) goTo(i);
    });
  });
}

function goTo(i: number) {
  state.current = i;
  renderSidebar();
  renderPane();
}

/* ===========================================================================
   Pane router
   =========================================================================== */

function renderPane() {
  const pane = byId<HTMLElement>("pane");
  switch (state.current) {
    case 0:
      pane.innerHTML =
        paneHead(
          "Étape 1",
          "Préparation",
          "On installe l’outil <b>TimeCapsuleSMB</b> et son environnement sur ce Mac. Rien n’est encore envoyé à la Time Capsule.",
        ) + renderPrep();
      bindPrep();
      break;
    case 1:
      pane.innerHTML =
        paneHead(
          "Étape 2",
          "Ta Time Capsule",
          "Choisis la Time Capsule sur ton réseau et saisis son mot de passe (le mot de passe administrateur défini dans Utilitaire AirPort).",
        ) + renderDevice();
      bindDevice();
      break;
    case 2:
      pane.innerHTML =
        paneHead(
          "Étape 3",
          "Activer le SSH",
          "Le SSH est désactivé par défaut. On l’active automatiquement via ACP avec ton mot de passe. <b>La Time Capsule va redémarrer</b> — compte 1 à 3 minutes.",
        ) + renderSsh();
      bindSsh();
      break;
    case 3:
      pane.innerHTML =
        paneHead(
          "Étape 4",
          "Installer Samba",
          "On dépose Samba SMB3 sur la Time Capsule puis elle redémarre pour démarrer le service. Ne coupe pas l’alimentation pendant l’opération.",
        ) + renderInstall();
      bindInstall();
      break;
    case 4:
      pane.innerHTML =
        paneHead(
          "Étape 5",
          "Terminé",
          "Vérifions que tout fonctionne, puis connecte-toi à ton partage.",
        ) + renderDone();
      bindDone();
      break;
  }
}

function paneHead(eyebrow: string, title: string, desc: string): string {
  return `<div class="pane-head">
    <div class="pane-eyebrow">${eyebrow}</div>
    <div class="pane-title">${title}</div>
    <div class="pane-desc">${desc}</div>
  </div>`;
}

/* ===========================================================================
   Step 1 — Préparation
   =========================================================================== */

type RowAction =
  | { kind: "ok" }
  | { kind: "button"; id: string; label: string }
  | { kind: "disabled"; hint: string };

function toolRow(
  title: string,
  sub: string,
  ok: boolean,
  optional: boolean,
  action: RowAction,
): string {
  const color = ok ? "var(--green)" : optional ? "var(--orange)" : "var(--red)";
  const icon = ok ? ICONS.ok : optional ? ICONS.warn : ICONS.x;
  let right = "";
  if (action.kind === "ok") right = `<span class="pill ok">OK</span>`;
  else if (action.kind === "disabled")
    right = `<span class="pill muted">${action.hint}</span>`;
  else
    right = `<button class="btn btn-secondary btn-sm" id="${action.id}">${action.label}</button>`;
  return `<div class="row-item">
    <div class="row-icon" style="background:${color}">${icon}</div>
    <div class="row-main">
      <div class="row-title">${title}</div>
      <div class="row-sub">${sub}</div>
    </div>
    ${right}
  </div>`;
}

function buildToolRows(e: EnvStatus): string {
  const brew = e.brew_ok;
  const ok: RowAction = { kind: "ok" };
  const xcode: RowAction = { kind: "button", id: "inst-xcode", label: "Installer" };
  const brewAct: RowAction = brew
    ? ok
    : { kind: "button", id: "inst-brew", label: "Installer (Terminal)" };
  const sshpassAct: RowAction = e.sshpass_ok
    ? ok
    : brew
      ? { kind: "button", id: "inst-sshpass", label: "Installer" }
      : { kind: "disabled", hint: "Homebrew requis" };
  const smbAct: RowAction = e.smbclient_ok
    ? ok
    : brew
      ? { kind: "button", id: "inst-smbclient", label: "Installer" }
      : { kind: "disabled", hint: "Homebrew requis" };

  return (
    toolRow(
      "Python 3.9+",
      e.python_ok
        ? `Détecté : Python ${e.python_version ?? "?"}`
        : "Requis. Fourni par les outils en ligne de commande Xcode.",
      e.python_ok,
      false,
      e.python_ok ? ok : xcode,
    ) +
    toolRow(
      "Git",
      e.git_ok ? "Disponible" : "Requis. Fourni par les outils Xcode.",
      e.git_ok,
      false,
      e.git_ok ? ok : xcode,
    ) +
    toolRow(
      "Homebrew",
      brew
        ? "Disponible"
        : "Gestionnaire de paquets — nécessaire pour installer sshpass et smbclient.",
      brew,
      true,
      brewAct,
    ) +
    toolRow(
      "sshpass",
      e.sshpass_ok
        ? "Disponible"
        : "Authentification SSH (fallback pour les modèles Gen 1-4).",
      e.sshpass_ok,
      true,
      sshpassAct,
    ) +
    toolRow(
      "smbclient",
      e.smbclient_ok
        ? "Disponible"
        : "Sert au test du partage SMB lors du diagnostic.",
      e.smbclient_ok,
      true,
      smbAct,
    )
  );
}

function renderPrep(): string {
  const e = state.env;
  if (!e) {
    return `<div class="card pad"><div class="empty">${spinner()} Analyse du système…</div></div>`;
  }

  const anyMissing =
    !e.python_ok || !e.git_ok || !e.brew_ok || !e.sshpass_ok || !e.smbclient_ok;
  const toolsCard = `<div class="card pad">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
      <div class="row-title" style="flex:1">Outils système</div>
      ${anyMissing ? `<button class="btn btn-primary btn-sm" id="install-all">Tout installer</button>` : ""}
      <button class="btn btn-secondary btn-sm" id="recheck">${ICONS.refresh} Revérifier</button>
    </div>
    <div class="tool-rows" id="tool-rows">${buildToolRows(e)}</div>
    <pre class="console" id="tools-log" style="display:none;margin-top:12px"></pre>
    <div class="step-status" id="tools-status"></div>
  </div>`;

  const ready = e.checkout_present && e.venv_present;
  const canBootstrap = e.python_ok && e.git_ok;
  const reco = (!e.smbclient_ok || !e.sshpass_ok) && !ready;

  const setupCard = `<div class="card pad">
    <div class="row-title" style="margin-bottom:2px">Outil TimeCapsuleSMB</div>
    <div class="row-sub" style="margin-bottom:10px">${
      ready
        ? "Déjà installé. Tu peux le réinstaller / mettre à jour."
        : "Télécharge l’outil et prépare l’environnement Python."
    }</div>
    ${
      reco
        ? `<div class="callout tip" style="margin:0 0 12px">${ICONS.info}<div>Pour un diagnostic complet, installe d’abord <b>smbclient</b> et <b>sshpass</b> ci-dessus (<b>sshpass</b> est nécessaire pour les modèles <b>Gen 1-4</b>).</div></div>`
        : ""
    }
    <div class="progress-track" id="prep-track" style="display:none"><div class="progress-fill indeterminate" id="prep-fill"></div></div>
    <pre class="console" id="prep-log" style="display:none"></pre>
    <div class="step-status" id="prep-status"></div>
    <button class="btn btn-primary" id="prep-run" ${canBootstrap ? "" : "disabled"}>${ready ? "Réinstaller / mettre à jour" : "Préparer l’outil"}</button>
    ${canBootstrap ? "" : `<div class="muted-note">Installe Python et Git (outils Xcode) avant de continuer.</div>`}
  </div>`;

  const continueBtn = `<div class="actions">
    <div class="spacer"></div>
    <button class="btn btn-primary" id="prep-next" ${state.prep === "done" || ready ? "" : "disabled"}>Continuer →</button>
  </div>`;

  return (
    `<div class="callout warn">${ICONS.warn}<div><b>Avant de commencer.</b> Dans <b>Utilitaire AirPort → ta borne → Modifier → Disques</b>, règle « Partage de disques sécurisé » sur <b>« Avec mot de passe de l’appareil »</b>. C’est ce mot de passe qu’on utilisera ici.</div></div>` +
    toolsCard +
    setupCard +
    continueBtn
  );
}

function bindPrep() {
  bindRowButtons();

  const recheck = document.getElementById("recheck") as HTMLButtonElement | null;
  if (recheck)
    recheck.addEventListener("click", async () => {
      const status = byId<HTMLElement>("tools-status");
      status.innerHTML = `${spinner()} Revérification…`;
      state.env = await call<EnvStatus>("check_env");
      if (state.env.checkout_present && state.env.venv_present) {
        state.prep = "done";
        unlock(1);
      }
      renderSidebar();
      renderPane();
    });

  const allBtn = document.getElementById("install-all") as HTMLButtonElement | null;
  if (allBtn) allBtn.addEventListener("click", installAll);

  const nextBtn = document.getElementById("prep-next") as HTMLButtonElement | null;
  const runBtn = document.getElementById("prep-run") as HTMLButtonElement | null;
  if (runBtn)
    runBtn.addEventListener("click", async () => {
      const log = byId<HTMLElement>("prep-log");
      const track = byId<HTMLElement>("prep-track");
      const status = byId<HTMLElement>("prep-status");
      log.style.display = "block";
      track.style.display = "block";
      log.textContent = "";
      state.prep = "running";
      runBtn.disabled = true;
      runBtn.innerHTML = `${spinner()} Installation…`;
      status.textContent = "Téléchargement et préparation en cours…";
      try {
        const code = await stream("setup", (l) => appendLog(log, l), DEMO_SETUP);
        if (code === 0) {
          state.prep = "done";
          state.env = await call<EnvStatus>("check_env");
          unlock(1);
          status.innerHTML = `<span style="color:var(--green);font-weight:600">✓ Outil prêt.</span>`;
          runBtn.innerHTML = "Réinstaller / mettre à jour";
          if (nextBtn) nextBtn.disabled = false;
          renderSidebar();
        } else {
          throw new Error("Le bootstrap a échoué (code " + code + ").");
        }
      } catch (err) {
        state.prep = "error";
        status.innerHTML = `<span style="color:var(--red);font-weight:600">✗ Échec : ${String(err)}</span>`;
        runBtn.innerHTML = "Réessayer";
      } finally {
        runBtn.disabled = false;
        track.style.display = "none";
      }
    });

  if (nextBtn) nextBtn.addEventListener("click", () => goTo(1));
}

function bindRowButtons() {
  const attach = (id: string, fn: (el: HTMLButtonElement) => void) => {
    const el = document.getElementById(id) as HTMLButtonElement | null;
    if (el) el.addEventListener("click", () => fn(el));
  };

  attach("inst-xcode", async (el) => {
    el.disabled = true;
    const status = byId<HTMLElement>("tools-status");
    status.textContent = "Ouverture de l’installeur Apple…";
    status.textContent = await call<string>("install_xcode_clt");
    el.disabled = false;
  });

  attach("inst-brew", async (el) => {
    el.disabled = true;
    const status = byId<HTMLElement>("tools-status");
    status.textContent = "Ouverture du Terminal…";
    const msg = await call<string>("install_homebrew");
    status.innerHTML = `<span style="color:var(--accent);font-weight:600">${msg}</span>`;
    el.disabled = false;
  });

  attach("inst-sshpass", () =>
    runToolInstall("install_sshpass", DEMO_BREW_SSHPASS, "Installation de sshpass"),
  );
  attach("inst-smbclient", () =>
    runToolInstall(
      "install_smbclient",
      DEMO_BREW_SAMBA,
      "Installation de smbclient (samba)",
    ),
  );
}

async function runToolInstall(cmd: string, demo: string[], label: string) {
  const log = byId<HTMLElement>("tools-log");
  const status = byId<HTMLElement>("tools-status");
  log.style.display = "block";
  log.textContent = "";
  status.innerHTML = `${spinner()} ${label}…`;
  document
    .querySelectorAll<HTMLButtonElement>("#tool-rows .btn, #recheck")
    .forEach((b) => (b.disabled = true));
  try {
    const code = await stream(cmd, (l) => appendLog(log, l), demo);
    state.env = await call<EnvStatus>("check_env");
    if (code === 0) {
      status.innerHTML = `<span style="color:var(--green);font-weight:600">✓ ${label} terminé.</span>`;
    } else {
      status.innerHTML = `<span style="color:var(--red);font-weight:600">✗ Échec — voir le journal ci-dessus.</span>`;
    }
  } catch (err) {
    status.innerHTML = `<span style="color:var(--red);font-weight:600">✗ ${String(err)}</span>`;
  } finally {
    refreshTools();
  }
}

/* Refresh the tool rows + buttons in place (keeps the log + status visible). */
function refreshTools() {
  const rows = document.getElementById("tool-rows");
  if (rows && state.env) {
    rows.innerHTML = buildToolRows(state.env);
    bindRowButtons();
  }
  const recheck = document.getElementById("recheck") as HTMLButtonElement | null;
  if (recheck) recheck.disabled = false;
  const all = document.getElementById("install-all") as HTMLButtonElement | null;
  if (all && state.env) {
    const e = state.env;
    const missing =
      !e.python_ok || !e.git_ok || !e.brew_ok || !e.sshpass_ok || !e.smbclient_ok;
    all.disabled = false;
    all.style.display = missing ? "" : "none";
  }
}

/* "Tout installer": chain what can be automated; hand off brew/Xcode when needed. */
async function installAll() {
  const e = state.env;
  if (!e) return;
  const status = byId<HTMLElement>("tools-status");

  if (!e.python_ok || !e.git_ok) {
    const msg = await call<string>("install_xcode_clt");
    status.innerHTML = `<span style="color:var(--accent);font-weight:600">${msg} Puis reclique « Tout installer ».</span>`;
    return;
  }
  if (!e.brew_ok) {
    const msg = await call<string>("install_homebrew");
    status.innerHTML = `<span style="color:var(--accent);font-weight:600">${msg} Ensuite, reclique « Tout installer » pour finir sshpass + smbclient.</span>`;
    return;
  }

  const log = byId<HTMLElement>("tools-log");
  log.style.display = "block";
  log.textContent = "";
  status.innerHTML = `${spinner()} Installation des outils…`;
  document
    .querySelectorAll<HTMLButtonElement>("#tool-rows .btn, #recheck, #install-all")
    .forEach((b) => (b.disabled = true));
  try {
    if (!e.sshpass_ok) {
      appendLog(log, { stream: "status", line: "→ Installation de sshpass…" });
      await stream("install_sshpass", (l) => appendLog(log, l), DEMO_BREW_SSHPASS);
    }
    if (!e.smbclient_ok) {
      appendLog(log, { stream: "status", line: "→ Installation de smbclient (samba)…" });
      await stream("install_smbclient", (l) => appendLog(log, l), DEMO_BREW_SAMBA);
    }
    state.env = await call<EnvStatus>("check_env");
    const ok = state.env.sshpass_ok && state.env.smbclient_ok;
    status.innerHTML = ok
      ? `<span style="color:var(--green);font-weight:600">✓ Tous les outils sont installés.</span>`
      : `<span style="color:var(--orange);font-weight:600">Certains outils manquent encore — voir le journal.</span>`;
  } catch (err) {
    state.env = await call<EnvStatus>("check_env");
    status.innerHTML = `<span style="color:var(--red);font-weight:600">✗ ${String(err)}</span>`;
  } finally {
    refreshTools();
  }
}

/* ===========================================================================
   Step 2 — Time Capsule
   =========================================================================== */

function renderDevice(): string {
  return (
    `<div class="card pad">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div class="row-title" style="flex:1">Appareils détectés</div>
        <button class="btn btn-secondary" id="dev-scan">${ICONS.search} Rechercher</button>
      </div>
      <div id="dev-list"><div class="empty">Clique sur « Rechercher » pour scanner ton réseau, ou saisis l’adresse manuellement ci-dessous.</div></div>
    </div>` +
    `<div class="card pad">
      <div class="field">
        <label class="field-label">Adresse de la Time Capsule (IP ou nom .local)</label>
        <input class="input" id="dev-host" placeholder="192.168.1.50" value="${escapeAttr(state.host)}" />
      </div>
      <div class="field" style="margin-bottom:0">
        <label class="field-label">Mot de passe de l’appareil</label>
        <div class="input-wrap">
          <input class="input" id="dev-pass" type="password" placeholder="Mot de passe administrateur AirPort" value="${escapeAttr(state.password)}" />
          <button class="reveal" id="dev-reveal" type="button">Afficher</button>
        </div>
      </div>
    </div>` +
    `<div class="callout tip">${ICONS.info}<div>On écrit un fichier de configuration local (<code>.env</code>) avec ces informations. Le mot de passe reste sur ton Mac et sur ta Time Capsule — rien n’est envoyé ailleurs.</div></div>` +
    `<div class="actions">
      <button class="btn btn-secondary" id="dev-back">← Retour</button>
      <div class="spacer"></div>
      <div class="step-status" id="dev-status" style="margin:0 8px 0 0"></div>
      <button class="btn btn-primary" id="dev-next" disabled>Enregistrer & continuer →</button>
    </div>`
  );
}

function renderDeviceList(): void {
  const list = byId<HTMLElement>("dev-list");
  if (state.discovering) {
    list.innerHTML = `<div class="empty">${spinner()} Recherche sur le réseau…</div>`;
    return;
  }
  if (state.devices.length === 0) {
    list.innerHTML = `<div class="empty">Aucun appareil trouvé. Saisis l’adresse manuellement ci-dessous.</div>`;
    return;
  }
  list.innerHTML = state.devices
    .map((d, i) => {
      const addr = d.host || d.ipv4[0] || d.hostname;
      const selected =
        state.host === addr || state.host === d.hostname ? "selected" : "";
      const tag = d.is_airport
        ? `<span class="pill info">AirPort / Time Capsule</span>`
        : `<span class="pill muted">Autre</span>`;
      const sub = [d.model ?? "", addr].filter(Boolean).join(" · ");
      return `<div class="device ${selected}" data-i="${i}">
        <div class="device-radio"></div>
        <div class="row-icon" style="background:${d.is_airport ? "linear-gradient(160deg,#38b6ff,#0a6cff)" : "var(--grey)"}">${ICONS.capsule}</div>
        <div class="row-main">
          <div class="row-title">${escapeHtml(d.name)}</div>
          <div class="row-sub">${escapeHtml(sub)}</div>
        </div>
        ${tag}
      </div>`;
    })
    .join("");

  list.querySelectorAll<HTMLElement>(".device").forEach((el) => {
    el.addEventListener("click", () => {
      const d = state.devices[Number(el.dataset.i)];
      state.host = d.host || d.ipv4[0] || d.hostname;
      state.smbHost = d.hostname || d.host || state.host;
      byId<HTMLInputElement>("dev-host").value = state.host;
      renderDeviceList();
      refreshDeviceNext();
    });
  });
}

function refreshDeviceNext() {
  const next = byId<HTMLButtonElement>("dev-next");
  next.disabled = !(state.host.trim() && state.password.trim());
}

function bindDevice() {
  renderDeviceList();
  refreshDeviceNext();

  byId<HTMLButtonElement>("dev-scan").addEventListener("click", async () => {
    state.discovering = true;
    renderDeviceList();
    try {
      state.devices = await call<DeviceInfo[]>("discover");
      const ap = state.devices.find((d) => d.is_airport);
      if (ap && !state.host) {
        state.host = ap.host || ap.ipv4[0] || ap.hostname;
        state.smbHost = ap.hostname || ap.host || state.host;
        byId<HTMLInputElement>("dev-host").value = state.host;
      }
    } catch (err) {
      state.devices = [];
      byId<HTMLElement>("dev-status").innerHTML =
        `<span style="color:var(--red)">Échec du scan : ${String(err)}</span>`;
    } finally {
      state.discovering = false;
      renderDeviceList();
      refreshDeviceNext();
    }
  });

  const hostInput = byId<HTMLInputElement>("dev-host");
  hostInput.addEventListener("input", () => {
    state.host = hostInput.value;
    state.smbHost = hostInput.value;
    refreshDeviceNext();
  });

  const passInput = byId<HTMLInputElement>("dev-pass");
  passInput.addEventListener("input", () => {
    state.password = passInput.value;
    refreshDeviceNext();
  });

  byId<HTMLButtonElement>("dev-reveal").addEventListener("click", () => {
    const reveal = byId<HTMLButtonElement>("dev-reveal");
    if (passInput.type === "password") {
      passInput.type = "text";
      reveal.textContent = "Masquer";
    } else {
      passInput.type = "password";
      reveal.textContent = "Afficher";
    }
  });

  byId<HTMLButtonElement>("dev-back").addEventListener("click", () => goTo(0));

  byId<HTMLButtonElement>("dev-next").addEventListener("click", async () => {
    const status = byId<HTMLElement>("dev-status");
    const next = byId<HTMLButtonElement>("dev-next");
    const bare = state.host.trim().replace(/^[^@]*@/, "");
    if (/^169\.254\./.test(bare) || /^fe80:/i.test(bare)) {
      status.innerHTML = `<span style="color:var(--red)">Adresse <b>link-local</b> (169.254.x.x) — utilise l’IP LAN de la borne (ex. 192.168.x.x) ou son nom <b>.local</b>.</span>`;
      return;
    }
    next.disabled = true;
    next.innerHTML = `${spinner()} Enregistrement…`;
    try {
      await call<string>("save_config", {
        host: state.host.trim(),
        password: state.password,
        useDiskRoot: state.useDiskRoot,
        anyProtocol: state.anyProtocol,
      });
      state.deviceSaved = true;
      if (!state.smbHost) state.smbHost = state.host.trim();
      unlock(2);
      renderSidebar();
      goTo(2);
    } catch (err) {
      status.innerHTML = `<span style="color:var(--red)">Échec : ${String(err)}</span>`;
      next.disabled = false;
      next.innerHTML = "Enregistrer & continuer →";
    }
  });
}

/* ===========================================================================
   Step 3 — Activer SSH
   =========================================================================== */

function renderSsh(): string {
  const done = state.ssh === "done";
  return (
    `<div class="callout tip">${ICONS.info}<div>Cette étape utilise le protocole <b>ACP</b> d’Apple (port 5009) pour activer SSH, puis attend le retour de la Time Capsule après son redémarrage. Aucune donnée n’est effacée.</div></div>` +
    `<div class="card pad">
      <div class="progress-track" id="ssh-track" style="display:none"><div class="progress-fill indeterminate" id="ssh-fill"></div></div>
      <pre class="console" id="ssh-log" style="display:none"></pre>
      <div class="step-status" id="ssh-status">${done ? '<span style="color:var(--green);font-weight:600">✓ SSH activé.</span>' : "Prêt à activer le SSH."}</div>
      <button class="btn btn-primary" id="ssh-run">${done ? "Réactiver le SSH" : "Activer le SSH"}</button>
    </div>` +
    `<div class="actions">
      <button class="btn btn-secondary" id="ssh-back">← Retour</button>
      <div class="spacer"></div>
      <button class="btn btn-primary" id="ssh-next" ${done ? "" : "disabled"}>Continuer →</button>
    </div>`
  );
}

function bindSsh() {
  byId<HTMLButtonElement>("ssh-back").addEventListener("click", () => goTo(1));
  const nextBtn = byId<HTMLButtonElement>("ssh-next");
  nextBtn.addEventListener("click", () => goTo(3));

  byId<HTMLButtonElement>("ssh-run").addEventListener("click", async () => {
    const log = byId<HTMLElement>("ssh-log");
    const track = byId<HTMLElement>("ssh-track");
    const status = byId<HTMLElement>("ssh-status");
    const run = byId<HTMLButtonElement>("ssh-run");
    log.style.display = "block";
    track.style.display = "block";
    log.textContent = "";
    run.disabled = true;
    run.innerHTML = `${spinner()} Activation…`;
    status.textContent = "Activation du SSH (la Time Capsule va redémarrer)…";
    state.ssh = "running";
    try {
      const code = await stream("enable_ssh", (l) => appendLog(log, l), DEMO_SSH);
      if (code === 0) {
        state.ssh = "done";
        unlock(3);
        status.innerHTML = `<span style="color:var(--green);font-weight:600">✓ SSH activé.</span>`;
        run.innerHTML = "Réactiver le SSH";
        nextBtn.disabled = false;
        renderSidebar();
      } else {
        throw new Error("set-ssh a renvoyé le code " + code + ".");
      }
    } catch (err) {
      state.ssh = "error";
      status.innerHTML = `<span style="color:var(--red);font-weight:600">✗ Échec : ${String(err)}</span> — vérifie l’adresse et le mot de passe à l’étape précédente.`;
      run.innerHTML = "Réessayer";
    } finally {
      run.disabled = false;
      track.style.display = "none";
    }
  });
}

/* ===========================================================================
   Step 4 — Installation (deploy)
   =========================================================================== */

const DEPLOY_MARKERS: [string, number][] = [
  ["Resolving deployment target", 5],
  ["Validating local artifacts", 12],
  ["Checking device compatibility", 18],
  ["Finding payload volume", 25],
  ["Stopping existing runtime", 32],
  ["Uploading deployment payload", 40],
  ["Uploaded smbd", 50],
  ["Uploaded mdns", 56],
  ["Uploaded nbns", 60],
  ["Uploaded boot files", 66],
  ["Uploaded runtime config", 70],
  ["Uploaded Samba account", 74],
  ["Applying file permissions", 80],
  ["Verifying uploaded payload", 86],
  ["Requesting reboot", 90],
  ["Waiting for managed runtime", 95],
  ["Deploy Finished", 100],
];

function renderInstall(): string {
  const done = state.install === "done";
  return (
    `<div class="callout warn">${ICONS.warn}<div><b>La Time Capsule va redémarrer</b> à la fin de l’installation. L’opération prend généralement 2 à 4 minutes. Ne débranche rien.</div></div>` +
    `<div class="card pad">
      <div class="progress-track" id="dep-track" style="display:none"><div class="progress-fill" id="dep-fill"></div></div>
      <pre class="console" id="dep-log" style="display:none"></pre>
      <div class="step-status" id="dep-status">${done ? '<span style="color:var(--green);font-weight:600">✓ Samba installé.</span>' : "Prêt à installer Samba SMB3 sur la Time Capsule."}</div>
      <button class="btn btn-primary" id="dep-run">${done ? "Réinstaller" : "Installer Samba"}</button>
    </div>` +
    `<div class="actions">
      <button class="btn btn-secondary" id="dep-back">← Retour</button>
      <div class="spacer"></div>
      <button class="btn btn-primary" id="dep-next" ${done ? "" : "disabled"}>Continuer →</button>
    </div>`
  );
}

function bindInstall() {
  byId<HTMLButtonElement>("dep-back").addEventListener("click", () => goTo(2));
  const nextBtn = byId<HTMLButtonElement>("dep-next");
  nextBtn.addEventListener("click", () => goTo(4));

  byId<HTMLButtonElement>("dep-run").addEventListener("click", async () => {
    const log = byId<HTMLElement>("dep-log");
    const track = byId<HTMLElement>("dep-track");
    const fill = byId<HTMLElement>("dep-fill");
    const status = byId<HTMLElement>("dep-status");
    const run = byId<HTMLButtonElement>("dep-run");
    log.style.display = "block";
    track.style.display = "block";
    fill.style.width = "0%";
    log.textContent = "";
    run.disabled = true;
    run.innerHTML = `${spinner()} Installation…`;
    status.textContent = "Installation en cours…";
    state.install = "running";
    try {
      const code = await stream(
        "deploy",
        (l) => {
          appendLog(log, l);
          if (l.line.includes("NetBSD4")) state.deviceFamily = "netbsd4";
          else if (l.line.includes("NetBSD6")) state.deviceFamily = "netbsd6";
          for (const [marker, pct] of DEPLOY_MARKERS) {
            if (l.line.includes(marker)) fill.style.width = pct + "%";
          }
        },
        DEMO_DEPLOY,
      );
      if (code === 0) {
        fill.style.width = "100%";
        state.install = "done";
        unlock(4);
        status.innerHTML = `<span style="color:var(--green);font-weight:600">✓ Samba installé et démarré.</span>`;
        run.innerHTML = "Réinstaller";
        nextBtn.disabled = false;
        renderSidebar();
      } else {
        throw new Error("deploy a renvoyé le code " + code + ".");
      }
    } catch (err) {
      state.install = "error";
      status.innerHTML = `<span style="color:var(--red);font-weight:600">✗ Échec : ${String(err)}</span>`;
      run.innerHTML = "Réessayer";
    } finally {
      run.disabled = false;
    }
  });
}

/* ===========================================================================
   Step 5 — Terminé (doctor + connect)
   =========================================================================== */

function pillClass(status: string): string {
  switch (status.toUpperCase()) {
    case "PASS":
      return "ok";
    case "FAIL":
      return "bad";
    case "WARN":
      return "warn";
    case "SKIP":
      return "skip";
    default:
      return "info";
  }
}

function renderDone(): string {
  const url = `smb://${state.smbHost || state.host || "time-capsule.local"}`;
  const hero =
    state.doctor && !state.doctor.fatal
      ? `<div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:6px 0 18px">
         <div class="hero-check">${ICONS.checkBig}</div>
         <div style="font-size:20px;font-weight:700">Ta Time Capsule est prête</div>
         <div class="pane-desc" style="margin-top:4px">Le partage SMB est actif. Connecte-toi depuis le Finder.</div>
       </div>`
      : "";

  const connect = `<div class="card pad">
    <div class="row-title" style="margin-bottom:8px">Se connecter</div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span class="smb-url" id="smb-url">${escapeHtml(url)}</span>
      <button class="btn btn-primary" id="open-finder">${ICONS.finder} Ouvrir dans le Finder</button>
    </div>
    <div class="muted-note">Dans le Finder : <b>Aller → Se connecter au serveur…</b> (⌘K), saisis l’adresse, puis utilise <b>n’importe quel identifiant</b> avec le mot de passe de l’appareil.</div>
  </div>`;

  const diag = `<div class="card pad">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <div class="row-title" style="flex:1">Diagnostic</div>
      <button class="btn btn-secondary" id="doc-run">${ICONS.refresh} ${state.doctor ? "Relancer" : "Lancer le diagnostic"}</button>
    </div>
    <div id="doc-list">${renderDoctorList()}</div>
  </div>`;

  const advanced = `<div class="actions">
    <button class="btn btn-secondary" id="done-back">← Retour</button>
    <div class="spacer"></div>
    <button class="btn btn-danger" id="uninstall-btn">Désinstaller…</button>
  </div>
  <pre class="console" id="uninstall-log" style="display:none;margin-top:12px"></pre>`;

  return hero + connect + diag + buildLegacy() + advanced;
}

/* Gen 1-4 (NetBSD 4) tools: activate (essential) + firmware tools (advanced). */
function buildLegacy(): string {
  const isOld = state.deviceFamily === "netbsd4";
  const banner = isOld
    ? `<div class="callout warn" style="margin:10px 0 4px">${ICONS.warn}<div>Ta borne est une <b>Gen 1-4 (NetBSD 4)</b> : Samba <b>ne démarre pas seul</b> au boot. Clique « Activer Samba » maintenant, et <b>après chaque redémarrage</b> de la borne.</div></div>`
    : `<div class="muted-note" style="margin:10px 0 4px">Pour les modèles <b>Gen 1-4 (NetBSD 4)</b> uniquement. Sur Gen 5, Samba démarre tout seul — tu n’as rien à faire ici.</div>`;
  return `<details class="card pad legacy" ${isOld ? "open" : ""}>
    <summary>Anciens modèles — Gen 1-4 (NetBSD 4)</summary>
    ${banner}
    <div style="display:flex;align-items:center;gap:10px;margin:10px 0 2px">
      <div class="row-main">
        <div class="row-title">Activer Samba</div>
        <div class="row-sub">À relancer après chaque redémarrage de la borne.</div>
      </div>
      <button class="btn btn-primary btn-sm" id="act-run">Activer Samba</button>
    </div>
    <details class="legacy-adv">
      <summary>Outils firmware (avancé)</summary>
      <div class="callout warn" style="margin:10px 0">${ICONS.warn}<div><b>Zone à risque.</b> Le « patch » de démarrage automatique modifie le firmware et <b>peut rendre la borne définitivement inutilisable</b>. Fais d’abord une <b>sauvegarde</b> et n’utilise ceci que si tu sais ce que tu fais.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px">
        <button class="btn btn-secondary btn-sm" id="flash-check">Vérifier le firmware</button>
        <button class="btn btn-secondary btn-sm" id="flash-backup">Sauvegarder le firmware</button>
        <button class="btn btn-danger btn-sm" id="flash-patch">Activer le démarrage auto (risqué)</button>
      </div>
    </details>
    <pre class="console" id="legacy-log" style="display:none;margin-top:12px"></pre>
    <div class="step-status" id="legacy-status"></div>
  </details>`;
}

async function runLegacy(cmd: string, demo: string[], label: string) {
  const log = byId<HTMLElement>("legacy-log");
  const status = byId<HTMLElement>("legacy-status");
  log.style.display = "block";
  log.textContent = "";
  status.innerHTML = `${spinner()} ${label}…`;
  document
    .querySelectorAll<HTMLButtonElement>(".legacy .btn")
    .forEach((b) => (b.disabled = true));
  try {
    const code = await stream(cmd, (l) => appendLog(log, l), demo);
    status.innerHTML =
      code === 0
        ? `<span style="color:var(--green);font-weight:600">✓ ${label} terminé.</span>`
        : `<span style="color:var(--red);font-weight:600">✗ Échec (code ${code}) — voir le journal.</span>`;
  } catch (err) {
    status.innerHTML = `<span style="color:var(--red);font-weight:600">✗ ${String(err)}</span>`;
  } finally {
    document
      .querySelectorAll<HTMLButtonElement>(".legacy .btn")
      .forEach((b) => (b.disabled = false));
  }
}

function renderDoctorList(): string {
  if (state.doctorRunning) {
    return `<div class="empty">${spinner()} Vérification en cours…</div>`;
  }
  if (!state.doctor) {
    return `<div class="empty">Lance le diagnostic pour vérifier le partage, le SSH et le service Samba.</div>`;
  }
  const rows = state.doctor.results
    .map(
      (r) => `<div class="row-item">
        <div class="row-main">
          <div class="row-title">${escapeHtml(r.message)}</div>
        </div>
        <span class="pill ${pillClass(r.status)}">${escapeHtml(r.status)}</span>
      </div>`,
    )
    .join("");
  const summary = state.doctor.fatal
    ? `<div class="callout warn" style="margin-top:12px">${ICONS.warn}<div>${escapeHtml(state.doctor.summary || "Des problèmes ont été détectés.")} Consulte les lignes en rouge ci-dessus.</div></div>`
    : "";
  return rows + summary;
}

function bindDone() {
  byId<HTMLButtonElement>("done-back").addEventListener("click", () => goTo(3));

  byId<HTMLButtonElement>("open-finder").addEventListener("click", () => {
    const url = `smb://${state.smbHost || state.host}`;
    call("open_smb", { url });
  });

  byId<HTMLButtonElement>("doc-run").addEventListener("click", runDoctor);

  byId<HTMLButtonElement>("uninstall-btn").addEventListener("click", async () => {
    const ok = window.confirm(
      "Désinstaller Samba de la Time Capsule ? Elle redémarrera et reviendra à son état d’origine. Tes données ne sont pas touchées.",
    );
    if (!ok) return;
    const log = byId<HTMLElement>("uninstall-log");
    log.style.display = "block";
    log.textContent = "";
    const btn = byId<HTMLButtonElement>("uninstall-btn");
    btn.disabled = true;
    btn.innerHTML = `${spinner()} Désinstallation…`;
    try {
      await stream("uninstall", (l) => appendLog(log, l), [
        "Uninstalling...",
        "Removing managed payload and boot files...",
        "Requesting reboot...",
        "Uninstall complete.",
      ]);
      btn.innerHTML = "Désinstaller…";
    } catch (err) {
      appendLog(log, { stream: "stderr", line: String(err) });
      btn.innerHTML = "Réessayer";
    } finally {
      btn.disabled = false;
    }
  });

  // --- Gen 1-4 (NetBSD 4) tools ---
  const onClick = (id: string, fn: () => void) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", fn);
  };
  onClick("act-run", () =>
    runLegacy("activate", DEMO_ACTIVATE, "Activation de Samba"),
  );
  onClick("flash-check", () =>
    runLegacy("flash_check", DEMO_FLASH_CHECK, "Vérification du firmware"),
  );
  onClick("flash-backup", () =>
    runLegacy("flash_backup", DEMO_FLASH_BACKUP, "Sauvegarde du firmware"),
  );
  onClick("flash-patch", () => {
    const ok = window.confirm(
      "⚠️ Patch du firmware (démarrage automatique)\n\n" +
        "Ceci modifie le firmware de la Time Capsule et PEUT LA RENDRE " +
        "DÉFINITIVEMENT INUTILISABLE (brick).\n\n" +
        "As-tu déjà fait une sauvegarde du firmware ? Ne continue que si tu es sûr.",
    );
    if (ok) runLegacy("flash_patch", DEMO_FLASH_PATCH, "Patch démarrage auto");
  });

  if (!state.doctor && !state.doctorRunning) runDoctor();
}

async function runDoctor() {
  state.doctorRunning = true;
  const list = document.getElementById("doc-list");
  if (list) list.innerHTML = renderDoctorList();
  try {
    state.doctor = await call<DoctorReport>("doctor");
  } catch (err) {
    state.doctor = {
      fatal: true,
      summary: "Le diagnostic n’a pas pu s’exécuter : " + String(err),
      results: [],
    };
  } finally {
    state.doctorRunning = false;
    renderSidebar();
    // Re-render so the success hero reflects the (now known) doctor result.
    // bindDone won't re-trigger the diagnostic because state.doctor is set.
    if (state.current === 4) {
      renderPane();
    } else {
      const l2 = document.getElementById("doc-list");
      if (l2) l2.innerHTML = renderDoctorList();
    }
  }
}

/* ===========================================================================
   Console logging
   =========================================================================== */

function appendLog(el: HTMLElement, l: LogLine) {
  if (l.stream === "status" && l.line.startsWith("__exit__")) return;
  const span = document.createElement("span");
  span.className = "log-" + l.stream;
  span.textContent = l.line + "\n";
  el.appendChild(span);
  el.scrollTop = el.scrollHeight;
}

/* ===========================================================================
   Escaping
   =========================================================================== */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

/* ===========================================================================
   Boot
   =========================================================================== */

async function init() {
  renderSidebar();
  renderPane();
  try {
    state.env = await call<EnvStatus>("check_env");
    if (state.env.venv_present) {
      state.prep = "done";
      unlock(1);
      // Returning user (tool + config already set up): open navigation so they
      // can jump to "Terminé" — e.g. to re-run "Activer Samba" on a Gen 1-4
      // after a reboot — without redoing every step.
      if (state.env.env_present) {
        state.deviceSaved = true;
        unlock(4);
      }
    }
  } catch {
    state.env = DEMO_ENV;
  }
  renderSidebar();
  if (state.current === 0) renderPane();
}

window.addEventListener("DOMContentLoaded", init);
