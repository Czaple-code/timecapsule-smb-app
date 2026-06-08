// TimeCapsule SMB — Tauri backend.
//
// This app is a GUI wrapper around the `tcapsule` CLI from
// https://github.com/jamesyc/TimeCapsuleSMB. It clones the tool into the app
// data directory, bootstraps its Python venv, writes the `.env` config itself
// (so the interactive `configure` step is never needed), and then drives
// `set-ssh` / `deploy` / `doctor`, streaming their output to the UI.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

const REPO_URL: &str = "https://github.com/jamesyc/TimeCapsuleSMB";

/// One line of streamed subprocess output sent to the frontend.
#[derive(Clone, Serialize)]
struct LogLine {
    /// "stdout" | "stderr" | "status"
    stream: String,
    line: String,
}

#[derive(Serialize)]
struct EnvStatus {
    python_ok: bool,
    python_version: Option<String>,
    git_ok: bool,
    smbclient_ok: bool,
    sshpass_ok: bool,
    brew_ok: bool,
    checkout_present: bool,
    venv_present: bool,
    env_present: bool,
    checkout_path: String,
}

#[derive(Serialize)]
struct DeviceInfo {
    name: String,
    hostname: String,
    ipv4: Vec<String>,
    /// Best connect target: first non-link-local/non-loopback IPv4, else the
    /// .local hostname. Avoids 169.254.x.x which the tool rejects.
    host: String,
    model: Option<String>,
    is_airport: bool,
}

/// A LAN-usable IPv4 (not link-local 169.254/16, loopback 127/8, or 0/8).
fn is_usable_v4(ip: &str) -> bool {
    !ip.starts_with("169.254.") && !ip.starts_with("127.") && !ip.starts_with("0.")
}

#[derive(Serialize, Clone)]
struct DoctorResult {
    status: String,
    message: String,
}

#[derive(Serialize)]
struct DoctorReport {
    fatal: bool,
    summary: String,
    results: Vec<DoctorResult>,
}

#[derive(Serialize)]
struct PathsInfo {
    checkout_path: String,
    env_path: String,
    venv_present: bool,
    checkout_present: bool,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// GUI apps on macOS inherit a minimal PATH; make sure the usual tool dirs are
/// present so `git`, `python3`, `smbclient`, `brew` resolve.
fn path_env() -> String {
    // Homebrew first so brew-installed tools win. Include samba's keg-only bin
    // dirs so `smbclient` (installed via `brew install samba`) is discoverable.
    let extra = "/opt/homebrew/bin:/opt/homebrew/opt/samba/bin:/usr/local/bin:\
                 /usr/local/opt/samba/bin:/usr/bin:/bin:/usr/sbin:/sbin";
    match std::env::var("PATH") {
        Ok(p) if !p.is_empty() => format!("{extra}:{p}"),
        _ => extra.to_string(),
    }
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn checkout_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("TimeCapsuleSMB"))
}

fn tcapsule_launcher(checkout: &Path) -> String {
    checkout.join("tcapsule").to_string_lossy().to_string()
}

fn which(name: &str) -> bool {
    Command::new("/usr/bin/which")
        .arg(name)
        .env("PATH", path_env())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn detect_python() -> (bool, Option<String>) {
    let out = Command::new("python3")
        .arg("--version")
        .env("PATH", path_env())
        .output();
    let Ok(out) = out else {
        return (false, None);
    };
    let mut text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if text.is_empty() {
        text = String::from_utf8_lossy(&out.stderr).trim().to_string();
    }
    // e.g. "Python 3.9.6"
    let version = text.split_whitespace().nth(1).map(|s| s.to_string());
    let ok = version
        .as_deref()
        .and_then(parse_minor_at_least_39)
        .unwrap_or(false);
    (ok, version)
}

/// Returns Some(true) if version string is >= 3.9, Some(false) if below, None if unparseable.
fn parse_minor_at_least_39(v: &str) -> Option<bool> {
    let mut parts = v.split('.');
    let major: u32 = parts.next()?.parse().ok()?;
    let minor: u32 = parts.next().unwrap_or("0").parse().ok()?;
    Some(major > 3 || (major == 3 && minor >= 9))
}

/// Build a Command pre-configured to run a `tcapsule` (or git) invocation with
/// the right cwd and environment so config/artifact resolution always works.
fn tool_command(program: &str, args: &[String], cwd: &Path) -> Command {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .current_dir(cwd)
        .env("PATH", path_env())
        .env("TCAPSULE_DISTRIBUTION_ROOT", cwd)
        .env("TCAPSULE_CONFIG", cwd.join(".env"))
        .stdin(Stdio::null());
    cmd
}

/// Run a command, streaming stdout+stderr to the channel line by line.
/// Returns the process exit code.
fn run_streaming(
    program: &str,
    args: &[String],
    cwd: &Path,
    on: &Channel<LogLine>,
) -> Result<i32, String> {
    let mut cmd = tool_command(program, args, cwd);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Impossible de lancer {program} : {e}"))?;

    let stdout = child.stdout.take().ok_or("stdout indisponible")?;
    let stderr = child.stderr.take().ok_or("stderr indisponible")?;

    let on_err = on.clone();
    let err_thread = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = on_err.send(LogLine {
                stream: "stderr".into(),
                line,
            });
        }
    });

    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        let _ = on.send(LogLine {
            stream: "stdout".into(),
            line,
        });
    }

    let _ = err_thread.join();
    let status = child.wait().map_err(|e| e.to_string())?;
    let code = status.code().unwrap_or(-1);
    let _ = on.send(LogLine {
        stream: "status".into(),
        line: format!("__exit__:{code}"),
    });
    Ok(code)
}

/// Run a command and capture stdout/stderr (for `--json` commands).
fn run_capture(program: &str, args: &[String], cwd: &Path) -> Result<(i32, String, String), String> {
    let out = tool_command(program, args, cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Impossible de lancer {program} : {e}"))?;
    Ok((
        out.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out.stdout).to_string(),
        String::from_utf8_lossy(&out.stderr).to_string(),
    ))
}

/// Shell-quote a value for the `.env` file (single-quoted, POSIX style).
fn sq(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn status_line(on: &Channel<LogLine>, msg: &str) {
    let _ = on.send(LogLine {
        stream: "status".into(),
        line: msg.into(),
    });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn check_env(app: AppHandle) -> Result<EnvStatus, String> {
    let checkout = checkout_dir(&app)?;
    let (python_ok, python_version) = detect_python();
    Ok(EnvStatus {
        python_ok,
        python_version,
        git_ok: which("git"),
        smbclient_ok: which("smbclient"),
        sshpass_ok: which("sshpass"),
        brew_ok: which("brew"),
        checkout_present: checkout.join(".git").exists(),
        venv_present: checkout.join(".venv").join("bin").join("tcapsule").exists(),
        env_present: checkout.join(".env").exists(),
        checkout_path: checkout.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn paths(app: AppHandle) -> Result<PathsInfo, String> {
    let checkout = checkout_dir(&app)?;
    Ok(PathsInfo {
        env_path: checkout.join(".env").to_string_lossy().to_string(),
        venv_present: checkout.join(".venv").join("bin").join("tcapsule").exists(),
        checkout_present: checkout.join(".git").exists(),
        checkout_path: checkout.to_string_lossy().to_string(),
    })
}

#[tauri::command]
async fn setup(app: AppHandle, on_event: Channel<LogLine>) -> Result<i32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let checkout = checkout_dir(&app)?;
        if let Some(parent) = checkout.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        if checkout.join(".git").exists() {
            status_line(&on_event, "Mise à jour de TimeCapsuleSMB…");
            let args = vec![
                "-C".to_string(),
                checkout.to_string_lossy().to_string(),
                "pull".to_string(),
                "--ff-only".to_string(),
            ];
            // A failed pull (e.g. offline) is non-fatal; we can still bootstrap
            // the existing checkout.
            let _ = run_streaming("git", &args, &checkout, &on_event);
        } else {
            status_line(&on_event, "Téléchargement de TimeCapsuleSMB…");
            let parent = checkout.parent().ok_or("dossier parent introuvable")?;
            let args = vec![
                "clone".to_string(),
                "--depth".to_string(),
                "1".to_string(),
                REPO_URL.to_string(),
                checkout.to_string_lossy().to_string(),
            ];
            let code = run_streaming("git", &args, parent, &on_event)?;
            if code != 0 {
                return Ok(code);
            }
        }

        status_line(&on_event, "Préparation de l'environnement Python (bootstrap)…");
        let args = vec![tcapsule_launcher(&checkout), "bootstrap".to_string()];
        let code = run_streaming("python3", &args, &checkout, &on_event)?;

        // The venv (and the `tcapsule` tool) is created *before* bootstrap's
        // host-tool step. On a Mac without Homebrew that step fails (exit 1),
        // but the tool itself is installed and usable on a Gen 5 device (SSH is
        // driven by pexpect, not sshpass). So judge success on the venv, and
        // just note any optional host tools that are still missing.
        let venv_ok = checkout
            .join(".venv")
            .join("bin")
            .join("tcapsule")
            .exists();
        if venv_ok {
            if code != 0 {
                status_line(
                    &on_event,
                    "Outil installé. Des outils hôte optionnels (sshpass / smbclient) manquent — \
                     installe-les ci-dessus pour un diagnostic complet.",
                );
            }
            Ok(0)
        } else {
            Ok(if code == 0 { 1 } else { code })
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// Tool installation
// ---------------------------------------------------------------------------

#[tauri::command]
fn install_xcode_clt() -> Result<String, String> {
    let installed = Command::new("/usr/bin/xcode-select")
        .arg("-p")
        .env("PATH", path_env())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if installed {
        return Ok("Les outils en ligne de commande Xcode sont déjà installés.".into());
    }
    let _ = Command::new("/usr/bin/xcode-select").arg("--install").status();
    Ok("Suis la fenêtre d'installation d'Apple qui vient de s'ouvrir, puis clique « Revérifier ».".into())
}

#[tauri::command]
fn install_homebrew(app: AppHandle) -> Result<String, String> {
    let dir = data_dir(&app)?;
    let script = dir.join("install-homebrew.command");
    let body = "#!/bin/bash\n\
        echo \"== Installation de Homebrew ==\"\n\
        echo \"Entre ton mot de passe Mac si demandé (la frappe reste invisible).\"\n\
        echo\n\
        /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"\n\
        echo\n\
        echo \"Terminé. Ferme cette fenêtre, reviens dans l'app et clique « Revérifier ».\"\n";
    std::fs::write(&script, body).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&script)
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script, perms).map_err(|e| e.to_string())?;
    }
    Command::new("/usr/bin/open")
        .arg("-a")
        .arg("Terminal")
        .arg(&script)
        .status()
        .map_err(|e| e.to_string())?;
    Ok("Le Terminal s'ouvre pour installer Homebrew — entre ton mot de passe Mac, attends « Terminé », puis reviens et clique « Revérifier ».".into())
}

async fn brew_install(
    app: AppHandle,
    on_event: Channel<LogLine>,
    pkgs: Vec<String>,
) -> Result<i32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !which("brew") {
            status_line(
                &on_event,
                "Homebrew est requis pour cette installation. Installe d'abord Homebrew.",
            );
            return Ok(1);
        }
        let dir = data_dir(&app)?;
        let mut args = vec!["install".to_string()];
        args.extend(pkgs);
        run_streaming("brew", &args, &dir, &on_event)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn install_sshpass(app: AppHandle, on_event: Channel<LogLine>) -> Result<i32, String> {
    // sshpass was removed from homebrew-core; use a well-known tap.
    brew_install(app, on_event, vec!["esolitos/ipa/sshpass".to_string()]).await
}

#[tauri::command]
async fn install_smbclient(app: AppHandle, on_event: Channel<LogLine>) -> Result<i32, String> {
    brew_install(app, on_event, vec!["samba".to_string()]).await
}

#[tauri::command]
fn save_config(
    app: AppHandle,
    host: String,
    password: String,
    use_disk_root: bool,
    any_protocol: bool,
) -> Result<String, String> {
    let checkout = checkout_dir(&app)?;
    std::fs::create_dir_all(&checkout).map_err(|e| e.to_string())?;

    let host = host.trim();
    let target = if host.contains('@') {
        host.to_string()
    } else {
        format!("root@{host}")
    };

    let ssh_opts = "-o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa \
                    -o KexAlgorithms=+diffie-hellman-group14-sha1 -o StrictHostKeyChecking=no \
                    -o UserKnownHostsFile=/dev/null";

    let body = format!(
        "# Local user/device configuration for TimeCapsuleSMB.\n\
         # Generated by TimeCapsule SMB.app\n\
         TC_HOST={}\n\
         TC_PASSWORD={}\n\
         TC_SSH_OPTS={}\n\
         TC_INTERNAL_SHARE_USE_DISK_ROOT={}\n\
         TC_ANY_PROTOCOL={}\n\
         TC_ATA_IDLE_SECONDS='300'\n\
         TC_ATA_STANDBY=''\n",
        sq(&target),
        sq(&password),
        sq(ssh_opts),
        sq(if use_disk_root { "true" } else { "false" }),
        sq(if any_protocol { "true" } else { "false" }),
    );

    let env_path = checkout.join(".env");
    std::fs::write(&env_path, body).map_err(|e| e.to_string())?;
    Ok(env_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn enable_ssh(app: AppHandle, on_event: Channel<LogLine>) -> Result<i32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let checkout = checkout_dir(&app)?;
        let args = vec![tcapsule_launcher(&checkout), "set-ssh".to_string()];
        run_streaming("python3", &args, &checkout, &on_event)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn deploy(app: AppHandle, on_event: Channel<LogLine>) -> Result<i32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let checkout = checkout_dir(&app)?;
        let args = vec![
            tcapsule_launcher(&checkout),
            "deploy".to_string(),
            "--yes".to_string(),
        ];
        run_streaming("python3", &args, &checkout, &on_event)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn uninstall(app: AppHandle, on_event: Channel<LogLine>) -> Result<i32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let checkout = checkout_dir(&app)?;
        let args = vec![
            tcapsule_launcher(&checkout),
            "uninstall".to_string(),
            "--yes".to_string(),
        ];
        run_streaming("python3", &args, &checkout, &on_event)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stream a `tcapsule <subcommand> [args...]` invocation to the channel.
async fn tcapsule_stream(
    app: AppHandle,
    on_event: Channel<LogLine>,
    sub: Vec<String>,
) -> Result<i32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let checkout = checkout_dir(&app)?;
        let mut args = vec![tcapsule_launcher(&checkout)];
        args.extend(sub);
        run_streaming("python3", &args, &checkout, &on_event)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Gen 1-4 (NetBSD 4): start Samba after a reboot. Safe; needed after each boot.
#[tauri::command]
async fn activate(app: AppHandle, on_event: Channel<LogLine>) -> Result<i32, String> {
    tcapsule_stream(app, on_event, vec!["activate".into(), "--yes".into()]).await
}

/// Gen 1-4: check whether the active firmware bank matches Apple stock. Read-only.
#[tauri::command]
async fn flash_check(app: AppHandle, on_event: Channel<LogLine>) -> Result<i32, String> {
    tcapsule_stream(app, on_event, vec!["flash".into(), "--check-apple".into()]).await
}

/// Gen 1-4: dump and back up the firmware banks before any write. Read-only.
#[tauri::command]
async fn flash_backup(app: AppHandle, on_event: Channel<LogLine>) -> Result<i32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let checkout = checkout_dir(&app)?;
        let backup = data_dir(&app)?.join("firmware-backup");
        std::fs::create_dir_all(&backup).map_err(|e| e.to_string())?;
        let args = vec![
            tcapsule_launcher(&checkout),
            "flash".to_string(),
            "--read-only".to_string(),
            "--backup-dir".to_string(),
            backup.to_string_lossy().to_string(),
        ];
        run_streaming("python3", &args, &checkout, &on_event)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Gen 1-4: patch the firmware LOGIN hook so Samba auto-starts on boot.
/// DANGEROUS — the only command that can permanently brick a device.
#[tauri::command]
async fn flash_patch(app: AppHandle, on_event: Channel<LogLine>) -> Result<i32, String> {
    tcapsule_stream(
        app,
        on_event,
        vec!["flash".into(), "--patch".into(), "--yes".into()],
    )
    .await
}

#[tauri::command]
async fn doctor(app: AppHandle) -> Result<DoctorReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let checkout = checkout_dir(&app)?;
        let args = vec![
            tcapsule_launcher(&checkout),
            "doctor".to_string(),
            "--json".to_string(),
        ];
        let (_code, stdout, stderr) = run_capture("python3", &args, &checkout)?;

        let parsed: serde_json::Value = serde_json::from_str(stdout.trim())
            .map_err(|_| {
                let detail = if stderr.trim().is_empty() {
                    stdout.trim().to_string()
                } else {
                    stderr.trim().to_string()
                };
                format!("Réponse inattendue de doctor : {detail}")
            })?;

        let results = parsed
            .get("results")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .map(|r| DoctorResult {
                        status: r
                            .get("status")
                            .and_then(|s| s.as_str())
                            .unwrap_or("INFO")
                            .to_string(),
                        message: r
                            .get("message")
                            .and_then(|s| s.as_str())
                            .unwrap_or("")
                            .to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(DoctorReport {
            fatal: parsed.get("fatal").and_then(|v| v.as_bool()).unwrap_or(false),
            summary: parsed
                .get("summary")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            results,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn discover(app: AppHandle) -> Result<Vec<DeviceInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let checkout = checkout_dir(&app)?;
        let args = vec![
            tcapsule_launcher(&checkout),
            "discover".to_string(),
            "--json".to_string(),
            "--timeout".to_string(),
            "6".to_string(),
        ];
        let (_code, stdout, stderr) = run_capture("python3", &args, &checkout)?;

        let parsed: serde_json::Value = serde_json::from_str(stdout.trim())
            .map_err(|_| {
                let detail = if stderr.trim().is_empty() {
                    stdout.trim().to_string()
                } else {
                    stderr.trim().to_string()
                };
                format!("Réponse inattendue de discover : {detail}")
            })?;

        Ok(group_resolved(&parsed))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Collapse discover's `resolved` records (one per service type) into one entry
/// per host, flagging which look like AirPort / Time Capsule devices.
fn group_resolved(parsed: &serde_json::Value) -> Vec<DeviceInfo> {
    use std::collections::BTreeMap;
    let mut by_host: BTreeMap<String, DeviceInfo> = BTreeMap::new();

    let empty = vec![];
    let resolved = parsed
        .get("resolved")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);

    for rec in resolved {
        let hostname = rec
            .get("hostname")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim_end_matches('.')
            .to_string();
        if hostname.is_empty() {
            continue;
        }
        let name = rec
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(&hostname)
            .to_string();
        let ipv4: Vec<String> = rec
            .get("ipv4")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let service_type = rec
            .get("service_type")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let services: Vec<String> = rec
            .get("services")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let model = rec
            .get("properties")
            .and_then(|v| v.as_object())
            .and_then(|m| m.get("model"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let model_hint = model.clone().unwrap_or_default().to_lowercase();
        let name_hint = format!("{name} {hostname}").to_lowercase();
        let is_airport = model_hint.contains("airport")
            || model_hint.contains("timecapsule")
            || model_hint.contains("time capsule")
            || name_hint.contains("capsule")
            || name_hint.contains("airport")
            || services.iter().any(|s| s.contains("_adisk"))
            || service_type.contains("_adisk")
            || service_type.contains("_airport")
            || service_type.contains("_sleep-proxy");

        let entry = by_host.entry(hostname.clone()).or_insert(DeviceInfo {
            name: name.clone(),
            hostname: hostname.clone(),
            ipv4: vec![],
            host: String::new(),
            model: None,
            is_airport: false,
        });
        for ip in ipv4 {
            if !entry.ipv4.contains(&ip) {
                entry.ipv4.push(ip);
            }
        }
        if entry.model.is_none() {
            entry.model = model;
        }
        entry.is_airport = entry.is_airport || is_airport;
    }

    let mut devices: Vec<DeviceInfo> = by_host.into_values().collect();
    // Pick the best connect target per device: a real LAN IPv4 if present,
    // otherwise the .local hostname (never a link-local 169.254 address).
    for d in devices.iter_mut() {
        d.host = d
            .ipv4
            .iter()
            .find(|ip| is_usable_v4(ip))
            .cloned()
            .unwrap_or_else(|| d.hostname.clone());
    }
    // AirPort/Time Capsule devices first, then alphabetical.
    devices.sort_by(|a, b| {
        b.is_airport
            .cmp(&a.is_airport)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    devices
}

#[tauri::command]
fn open_smb(url: String) -> Result<(), String> {
    Command::new("/usr/bin/open")
        .arg(&url)
        .status()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    Command::new("/usr/bin/open")
        .arg(&path)
        .status()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            check_env,
            paths,
            setup,
            install_xcode_clt,
            install_homebrew,
            install_sshpass,
            install_smbclient,
            save_config,
            enable_ssh,
            deploy,
            uninstall,
            activate,
            flash_check,
            flash_backup,
            flash_patch,
            doctor,
            discover,
            open_smb,
            open_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
