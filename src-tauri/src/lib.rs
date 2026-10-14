use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use ssh2::Session;
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpStream, ToSocketAddrs, UdpSocket},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use thiserror::Error;

const SSH_PASSWORD_SERVICE: &str = "local-llm-client.ssh";
const SSH_KEY_SERVICE: &str = "local-llm-client.ssh-key";
const MAX_TOOL_OUTPUT: usize = 1024 * 1024;
const MAX_AGENT_STEP_CONTEXT: usize = 128 * 1024;
static TUNNELS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
static RUNTIMES: OnceLock<Mutex<HashMap<String, RuntimeInstance>>> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Error)]
enum BackendError {
    #[error("configuration error: {0}")]
    Configuration(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("SSH authentication failed: {0}")]
    Authentication(String),
    #[error("SSH command failed: {0}")]
    Command(String),
    #[error("credential error: {0}")]
    Credential(String),
    #[error("model API error: {0}")]
    ModelApi(String),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellResult {
    command: String,
    stdout: String,
    stderr: String,
    exit_code: i32,
    duration_ms: u128,
    timed_out: bool,
    truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInstance {
    pid: u32,
    model_id: String,
    port: u16,
    started_at: String,
    status: String,
    owned_by_app: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TunnelInfo {
    id: String,
    local_port: u16,
    remote_port: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileMetadata {
    path: String,
    size: u64,
    modified_at: String,
    is_directory: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFile {
    path: String,
    content: String,
    start_line: usize,
    end_line: usize,
    truncated: bool,
}

#[derive(Debug, Serialize)]
struct SearchMatch {
    path: String,
    line: usize,
    text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PatchResult {
    diff: String,
    changed_paths: Vec<String>,
}

impl Serialize for BackendError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SshConnection {
    host: String,
    port: u16,
    username: String,
    authentication: String,
    private_key_path: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatRequest {
    request_id: String,
    base_url: String,
    model: String,
    temperature: f32,
    messages: Vec<ChatMessage>,
}

fn resolve_address(host: &str, port: u16) -> Result<SocketAddr, BackendError> {
    if host.trim().is_empty() {
        return Err(BackendError::Configuration("host is required".into()));
    }
    (host, port)
        .to_socket_addrs()
        .map_err(|error| BackendError::Network(error.to_string()))?
        .next()
        .ok_or_else(|| BackendError::Network("host did not resolve".into()))
}

#[tauri::command]
async fn check_host(host: String, port: u16, timeout_ms: u64) -> Result<bool, BackendError> {
    tauri::async_runtime::spawn_blocking(move || {
        let address = resolve_address(&host, port)?;
        Ok(TcpStream::connect_timeout(&address, Duration::from_millis(timeout_ms)).is_ok())
    })
    .await
    .map_err(|error| BackendError::Network(error.to_string()))?
}

fn parse_mac_address(mac_address: &str) -> Result<[u8; 6], BackendError> {
    let cleaned: String = mac_address
        .chars()
        .filter(|character| character.is_ascii_hexdigit())
        .collect();
    if cleaned.len() != 12 {
        return Err(BackendError::Configuration(
            "MAC address must contain exactly 12 hexadecimal characters".into(),
        ));
    }
    let mut bytes = [0u8; 6];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&cleaned[index * 2..index * 2 + 2], 16)
            .map_err(|_| BackendError::Configuration("invalid MAC address".into()))?;
    }
    Ok(bytes)
}

#[tauri::command]
async fn send_magic_packet(
    mac_address: String,
    broadcast_address: String,
) -> Result<(), BackendError> {
    tauri::async_runtime::spawn_blocking(move || {
        let mac = parse_mac_address(&mac_address)?;
        let address: SocketAddr = broadcast_address.parse().map_err(|_| {
            BackendError::Configuration("broadcast address must include a port".into())
        })?;
        let mut packet = [0u8; 102];
        packet[..6].fill(0xff);
        for offset in 0..16 {
            packet[6 + offset * 6..12 + offset * 6].copy_from_slice(&mac);
        }
        let socket = UdpSocket::bind("0.0.0.0:0")
            .map_err(|error| BackendError::Network(error.to_string()))?;
        socket
            .set_broadcast(true)
            .map_err(|error| BackendError::Network(error.to_string()))?;
        socket
            .send_to(&packet, address)
            .map_err(|error| BackendError::Network(error.to_string()))?;
        Ok(())
    })
    .await
    .map_err(|error| BackendError::Network(error.to_string()))?
}

#[tauri::command]
async fn execute_custom_wake(command: String) -> Result<(), BackendError> {
    tauri::async_runtime::spawn_blocking(move || {
        let arguments = shell_words::split(&command)
            .map_err(|error| BackendError::Configuration(error.to_string()))?;
        let executable = arguments
            .first()
            .ok_or_else(|| BackendError::Configuration("custom wake command is empty".into()))?;
        if !Path::new(executable).is_absolute() {
            return Err(BackendError::Configuration(
                "custom wake executable must use an absolute path".into(),
            ));
        }
        let status = Command::new(executable)
            .args(&arguments[1..])
            .status()
            .map_err(|error| BackendError::Command(error.to_string()))?;
        if status.success() {
            Ok(())
        } else {
            Err(BackendError::Command(format!(
                "custom wake process exited with {status}"
            )))
        }
    })
    .await
    .map_err(|error| BackendError::Command(error.to_string()))?
}

fn expanded_path(value: &str) -> PathBuf {
    if value == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from(value));
    }
    if let Some(remainder) = value.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(remainder);
        }
    }
    PathBuf::from(value)
}

fn keychain_secret(service: &str, account: &str) -> Option<String> {
    keyring::Entry::new(service, account)
        .ok()
        .and_then(|entry| entry.get_password().ok())
}

fn open_ssh(connection: &SshConnection) -> Result<Session, BackendError> {
    let address = resolve_address(&connection.host, connection.port)?;
    let tcp = TcpStream::connect_timeout(&address, Duration::from_secs(8))
        .map_err(|error| BackendError::Network(error.to_string()))?;
    tcp.set_read_timeout(Some(Duration::from_secs(30))).ok();
    tcp.set_write_timeout(Some(Duration::from_secs(30))).ok();

    let mut session = Session::new().map_err(|error| BackendError::Network(error.to_string()))?;
    session.set_tcp_stream(tcp);
    session
        .handshake()
        .map_err(|error| BackendError::Network(error.to_string()))?;

    match connection.authentication.as_str() {
        "password" => {
            let password =
                keychain_secret(SSH_PASSWORD_SERVICE, &connection.username).ok_or_else(|| {
                    BackendError::Credential("SSH password is not in Keychain".into())
                })?;
            session
                .userauth_password(&connection.username, &password)
                .map_err(|error| BackendError::Authentication(error.to_string()))?;
        }
        "key" => {
            let passphrase = keychain_secret(SSH_KEY_SERVICE, &connection.username);
            session
                .userauth_pubkey_file(
                    &connection.username,
                    None,
                    &expanded_path(&connection.private_key_path),
                    passphrase.as_deref(),
                )
                .map_err(|error| BackendError::Authentication(error.to_string()))?;
        }
        other => {
            return Err(BackendError::Configuration(format!(
                "unsupported authentication type: {other}"
            )))
        }
    }

    if !session.authenticated() {
        return Err(BackendError::Authentication(
            "server rejected credentials".into(),
        ));
    }
    Ok(session)
}

#[tauri::command]
async fn check_ssh(connection: SshConnection) -> Result<(), BackendError> {
    tauri::async_runtime::spawn_blocking(move || open_ssh(&connection).map(|_| ()))
        .await
        .map_err(|error| BackendError::Network(error.to_string()))?
}

fn truncate_output(mut value: String) -> (String, bool) {
    if value.len() <= MAX_TOOL_OUTPUT {
        return (value, false);
    }
    let mut boundary = MAX_TOOL_OUTPUT;
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value.truncate(boundary);
    value.push_str("\n[output truncated]");
    (value, true)
}

fn execute_ssh_inner(
    connection: &SshConnection,
    command: &str,
    timeout_ms: u64,
) -> Result<ShellResult, BackendError> {
    if command.trim().is_empty() || command.len() > 16_384 {
        return Err(BackendError::Configuration(
            "invalid remote command length".into(),
        ));
    }
    let started = Instant::now();
    let session = open_ssh(connection)?;
    session.set_timeout(timeout_ms.min(u32::MAX as u64) as u32);
    let mut channel = session
        .channel_session()
        .map_err(|error| BackendError::Command(error.to_string()))?;
    channel
        .exec(command)
        .map_err(|error| BackendError::Command(error.to_string()))?;
    session.set_blocking(false);
    let mut stderr_stream = channel.stderr();
    let mut stdout_bytes = Vec::new();
    let mut stderr_bytes = Vec::new();
    let mut stdout_truncated = false;
    let mut stderr_truncated = false;
    let mut stdout_buffer = [0u8; 16 * 1024];
    let mut stderr_buffer = [0u8; 16 * 1024];
    loop {
        if started.elapsed() > Duration::from_millis(timeout_ms) {
            channel.close().ok();
            return Err(BackendError::Network("SSH command timed out".into()));
        }
        let mut progressed = false;
        match channel.read(&mut stdout_buffer) {
            Ok(size) if size > 0 => {
                let remaining = MAX_TOOL_OUTPUT.saturating_sub(stdout_bytes.len());
                stdout_bytes.extend_from_slice(&stdout_buffer[..size.min(remaining)]);
                stdout_truncated |= size > remaining;
                progressed = true;
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(error) => return Err(BackendError::Network(error.to_string())),
        }
        match stderr_stream.read(&mut stderr_buffer) {
            Ok(size) if size > 0 => {
                let remaining = MAX_TOOL_OUTPUT.saturating_sub(stderr_bytes.len());
                stderr_bytes.extend_from_slice(&stderr_buffer[..size.min(remaining)]);
                stderr_truncated |= size > remaining;
                progressed = true;
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(error) => return Err(BackendError::Network(error.to_string())),
        }
        if channel.eof() && !progressed {
            break;
        }
        if !progressed {
            std::thread::sleep(Duration::from_millis(4));
        }
    }
    drop(stderr_stream);
    session.set_blocking(true);
    channel
        .wait_close()
        .map_err(|error| BackendError::Network(error.to_string()))?;
    let exit_code = channel
        .exit_status()
        .map_err(|error| BackendError::Command(error.to_string()))?;
    let mut stdout = String::from_utf8_lossy(&stdout_bytes).to_string();
    let mut stderr = String::from_utf8_lossy(&stderr_bytes).to_string();
    if stdout_truncated {
        stdout.push_str("\n[output truncated]");
    }
    if stderr_truncated {
        stderr.push_str("\n[output truncated]");
    }
    Ok(ShellResult {
        command: command.to_string(),
        stdout,
        stderr,
        exit_code,
        duration_ms: started.elapsed().as_millis(),
        timed_out: false,
        truncated: stdout_truncated || stderr_truncated,
    })
}

#[tauri::command]
async fn execute_ssh(
    connection: SshConnection,
    command: String,
    timeout_ms: u64,
) -> Result<ShellResult, BackendError> {
    tauri::async_runtime::spawn_blocking(move || {
        execute_ssh_inner(&connection, &command, timeout_ms)
    })
    .await
    .map_err(|error| BackendError::Command(error.to_string()))?
}

fn bridge_tunnel(
    mut local: TcpStream,
    connection: SshConnection,
    remote_port: u16,
) -> Result<(), BackendError> {
    let session = open_ssh(&connection)?;
    let mut channel = session
        .channel_direct_tcpip("127.0.0.1", remote_port, None)
        .map_err(|error| BackendError::Network(error.to_string()))?;
    local
        .set_nonblocking(true)
        .map_err(|error| BackendError::Network(error.to_string()))?;
    session.set_blocking(false);
    let mut local_buffer = [0u8; 16 * 1024];
    let mut remote_buffer = [0u8; 16 * 1024];
    loop {
        let mut progressed = false;
        match local.read(&mut local_buffer) {
            Ok(0) => break,
            Ok(size) => {
                channel
                    .write_all(&local_buffer[..size])
                    .map_err(|error| BackendError::Network(error.to_string()))?;
                channel.flush().ok();
                progressed = true;
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(error) => return Err(BackendError::Network(error.to_string())),
        }
        match channel.read(&mut remote_buffer) {
            Ok(0) if channel.eof() => break,
            Ok(0) => {}
            Ok(size) => {
                local
                    .write_all(&remote_buffer[..size])
                    .map_err(|error| BackendError::Network(error.to_string()))?;
                progressed = true;
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(error) => return Err(BackendError::Network(error.to_string())),
        }
        if !progressed {
            std::thread::sleep(Duration::from_millis(4));
        }
    }
    channel.send_eof().ok();
    channel.close().ok();
    Ok(())
}

#[tauri::command]
async fn start_ssh_tunnel(
    connection: SshConnection,
    remote_port: u16,
) -> Result<TunnelInfo, BackendError> {
    if remote_port == 0 {
        return Err(BackendError::Configuration(
            "remote tunnel port is invalid".into(),
        ));
    }
    tauri::async_runtime::spawn_blocking(move || {
        open_ssh(&connection)?;
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0))
            .map_err(|error| BackendError::Network(error.to_string()))?;
        let local_port = listener
            .local_addr()
            .map_err(|error| BackendError::Network(error.to_string()))?
            .port();
        listener
            .set_nonblocking(true)
            .map_err(|error| BackendError::Network(error.to_string()))?;
        let id = format!("tunnel-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed));
        let stopped = Arc::new(AtomicBool::new(false));
        TUNNELS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .map_err(|_| BackendError::Network("tunnel registry is unavailable".into()))?
            .insert(id.clone(), Arc::clone(&stopped));
        std::thread::spawn(move || {
            while !stopped.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((local, _)) => {
                        let connection = SshConnection {
                            host: connection.host.clone(),
                            port: connection.port,
                            username: connection.username.clone(),
                            authentication: connection.authentication.clone(),
                            private_key_path: connection.private_key_path.clone(),
                        };
                        std::thread::spawn(move || {
                            let _ = bridge_tunnel(local, connection, remote_port);
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(20));
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(TunnelInfo {
            id,
            local_port,
            remote_port,
        })
    })
    .await
    .map_err(|error| BackendError::Network(error.to_string()))?
}

#[tauri::command]
fn stop_ssh_tunnel(tunnel_id: String) -> Result<(), BackendError> {
    let stopped = TUNNELS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| BackendError::Network("tunnel registry is unavailable".into()))?
        .remove(&tunnel_id);
    if let Some(stopped) = stopped {
        stopped.store(true, Ordering::Relaxed);
    }
    Ok(())
}

fn runtime_key(connection: &SshConnection, model_id: &str, port: u16) -> String {
    format!(
        "{}:{}:{}:{}",
        connection.host, connection.username, model_id, port
    )
}

fn powershell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn powershell_encoded(script: &str) -> String {
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    format!(
        "powershell.exe -NoProfile -NonInteractive -EncodedCommand {}",
        BASE64.encode(bytes)
    )
}

fn unix_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

#[tauri::command]
async fn start_remote_runtime(
    connection: SshConnection,
    executable: String,
    args: Vec<String>,
    model_id: String,
    port: u16,
) -> Result<RuntimeInstance, BackendError> {
    if executable.trim().is_empty()
        || !(executable.contains(":\\") || executable.starts_with("\\\\"))
    {
        return Err(BackendError::Configuration(
            "runtime executable must be an absolute Windows path".into(),
        ));
    }
    let key = runtime_key(&connection, &model_id, port);
    {
        let mut runtimes = RUNTIMES
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .map_err(|_| BackendError::Command("runtime registry is unavailable".into()))?;
        if let Some(existing) = runtimes.get(&key).cloned() {
            if existing.status == "running" {
                return Ok(existing);
            }
            runtimes.remove(&key);
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let arguments = args.iter().map(|arg| powershell_quote(arg)).collect::<Vec<_>>().join(",");
        let script = format!(
            "$ErrorActionPreference='Stop'; $exe={}; if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {{ throw 'runtime executable not found' }}; $p=Start-Process -FilePath $exe -ArgumentList @({}) -WindowStyle Hidden -PassThru; [Console]::Out.Write($p.Id)",
            powershell_quote(&executable), arguments
        );
        let result = execute_ssh_inner(&connection, &powershell_encoded(&script), 30_000)?;
        if result.exit_code != 0 {
            return Err(BackendError::Command(result.stderr));
        }
        let pid = result
            .stdout
            .trim()
            .parse::<u32>()
            .map_err(|_| BackendError::Command("runtime did not return a PID".into()))?;
        let instance = RuntimeInstance {
            pid,
            model_id: model_id.clone(),
            port,
            started_at: unix_timestamp(),
            status: "running".into(),
            owned_by_app: true,
        };
        RUNTIMES
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .map_err(|_| BackendError::Command("runtime registry is unavailable".into()))?
            .insert(key, instance.clone());
        Ok(instance)
    })
    .await
    .map_err(|error| BackendError::Command(error.to_string()))?
}

#[tauri::command]
async fn inspect_remote_runtime(
    connection: SshConnection,
    model_id: String,
    port: u16,
) -> Result<Option<RuntimeInstance>, BackendError> {
    let key = runtime_key(&connection, &model_id, port);
    let Some(mut instance) = RUNTIMES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| BackendError::Command("runtime registry is unavailable".into()))?
        .get(&key)
        .cloned()
    else {
        return Ok(None);
    };
    let pid = instance.pid;
    let alive = tauri::async_runtime::spawn_blocking(move || {
        let script = format!("if (Get-Process -Id {} -ErrorAction SilentlyContinue) {{ [Console]::Out.Write('alive') }}", pid);
        execute_ssh_inner(&connection, &powershell_encoded(&script), 10_000)
            .map(|result| result.exit_code == 0 && result.stdout.trim() == "alive")
    })
    .await
    .map_err(|error| BackendError::Command(error.to_string()))??;
    instance.status = if alive { "running" } else { "crashed" }.into();
    RUNTIMES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| BackendError::Command("runtime registry is unavailable".into()))?
        .insert(key, instance.clone());
    Ok(Some(instance))
}

#[tauri::command]
async fn stop_remote_runtime(
    connection: SshConnection,
    pid: u32,
    model_id: String,
    port: u16,
) -> Result<(), BackendError> {
    let key = runtime_key(&connection, &model_id, port);
    let owned = RUNTIMES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| BackendError::Command("runtime registry is unavailable".into()))?
        .get(&key)
        .is_some_and(|instance| instance.owned_by_app && instance.pid == pid);
    if !owned {
        return Err(BackendError::Configuration(
            "refusing to stop a runtime not owned by this app session".into(),
        ));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let script = format!("$p=Get-Process -Id {} -ErrorAction SilentlyContinue; if ($p) {{ Stop-Process -InputObject $p -Force }}", pid);
        let result = execute_ssh_inner(&connection, &powershell_encoded(&script), 15_000)?;
        if result.exit_code == 0 { Ok(()) } else { Err(BackendError::Command(result.stderr)) }
    })
    .await
    .map_err(|error| BackendError::Command(error.to_string()))??;
    RUNTIMES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| BackendError::Command("runtime registry is unavailable".into()))?
        .remove(&key);
    Ok(())
}

#[tauri::command]
fn store_credential(service: String, account: String, secret: String) -> Result<(), BackendError> {
    if !matches!(service.as_str(), SSH_PASSWORD_SERVICE | SSH_KEY_SERVICE) {
        return Err(BackendError::Configuration(
            "credential service is not allowed".into(),
        ));
    }
    if account.trim().is_empty() || secret.is_empty() {
        return Err(BackendError::Configuration(
            "credential account and secret are required".into(),
        ));
    }
    keyring::Entry::new(&service, &account)
        .map_err(|error| BackendError::Credential(error.to_string()))?
        .set_password(&secret)
        .map_err(|error| BackendError::Credential(error.to_string()))
}

fn canonical_workspace(root_path: &str) -> Result<PathBuf, BackendError> {
    let root = fs::canonicalize(expanded_path(root_path))
        .map_err(|error| BackendError::Configuration(format!("invalid workspace: {error}")))?;
    if !root.is_dir() {
        return Err(BackendError::Configuration(
            "workspace root must be a directory".into(),
        ));
    }
    Ok(root)
}

fn safe_workspace_path(
    root: &Path,
    relative: &str,
    must_exist: bool,
) -> Result<PathBuf, BackendError> {
    let candidate = Path::new(relative);
    if candidate.is_absolute()
        || candidate.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(BackendError::Configuration(
            "path is outside the workspace boundary".into(),
        ));
    }
    let joined = root.join(candidate);
    if must_exist {
        let canonical = fs::canonicalize(&joined).map_err(|error| {
            BackendError::Configuration(format!("workspace path is invalid: {error}"))
        })?;
        if !canonical.starts_with(root) {
            return Err(BackendError::Configuration(
                "symlink escapes the workspace boundary".into(),
            ));
        }
        Ok(canonical)
    } else {
        let parent = joined.parent().unwrap_or(root);
        let canonical_parent = fs::canonicalize(parent).map_err(|error| {
            BackendError::Configuration(format!("workspace parent is invalid: {error}"))
        })?;
        if !canonical_parent.starts_with(root) {
            return Err(BackendError::Configuration(
                "path escapes the workspace boundary".into(),
            ));
        }
        if joined.exists() {
            let canonical = fs::canonicalize(&joined).map_err(|error| {
                BackendError::Configuration(format!("workspace path is invalid: {error}"))
            })?;
            if !canonical.starts_with(root) {
                return Err(BackendError::Configuration(
                    "symlink escapes the workspace boundary".into(),
                ));
            }
        }
        Ok(joined)
    }
}

fn relative_display(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn metadata_value(root: &Path, path: &Path) -> Result<FileMetadata, BackendError> {
    let metadata =
        fs::metadata(path).map_err(|error| BackendError::Configuration(error.to_string()))?;
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs().to_string())
        .unwrap_or_default();
    Ok(FileMetadata {
        path: relative_display(root, path),
        size: metadata.len(),
        modified_at,
        is_directory: metadata.is_dir(),
    })
}

#[tauri::command]
fn validate_workspace(root_path: String) -> Result<String, BackendError> {
    Ok(canonical_workspace(&root_path)?
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
fn list_workspace_directory(
    root_path: String,
    path: String,
    limit: usize,
) -> Result<Vec<FileMetadata>, BackendError> {
    let root = canonical_workspace(&root_path)?;
    let directory = safe_workspace_path(&root, &path, true)?;
    if !directory.is_dir() {
        return Err(BackendError::Configuration(
            "list_directory target is not a directory".into(),
        ));
    }
    let mut entries = fs::read_dir(directory)
        .map_err(|error| BackendError::Configuration(error.to_string()))?
        .take(limit.clamp(1, 2_000))
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_type()
                .map(|kind| !kind.is_symlink())
                .unwrap_or(false)
        })
        .map(|entry| metadata_value(&root, &entry.path()))
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then(a.path.cmp(&b.path))
    });
    Ok(entries)
}

#[tauri::command]
fn read_workspace_file(
    root_path: String,
    path: String,
    start_line: usize,
    end_line: usize,
) -> Result<WorkspaceFile, BackendError> {
    let root = canonical_workspace(&root_path)?;
    let file = safe_workspace_path(&root, &path, true)?;
    let metadata =
        fs::metadata(&file).map_err(|error| BackendError::Configuration(error.to_string()))?;
    if !metadata.is_file() || metadata.len() > MAX_TOOL_OUTPUT as u64 {
        return Err(BackendError::Configuration(
            "file is not readable or exceeds the 1 MiB limit".into(),
        ));
    }
    let bytes = fs::read(&file).map_err(|error| BackendError::Configuration(error.to_string()))?;
    if bytes.iter().take(8_192).any(|byte| *byte == 0) {
        return Err(BackendError::Configuration(
            "binary files cannot be read as text".into(),
        ));
    }
    let content = String::from_utf8(bytes)
        .map_err(|_| BackendError::Configuration("file is not UTF-8 text".into()))?;
    let lines: Vec<&str> = content.lines().collect();
    let start = start_line.max(1);
    let end = end_line
        .max(start)
        .min(start.saturating_add(2_000))
        .min(lines.len());
    let selected = if start > lines.len() {
        String::new()
    } else {
        lines[start - 1..end].join("\n")
    };
    Ok(WorkspaceFile {
        path: relative_display(&root, &file),
        content: selected,
        start_line: start,
        end_line: end,
        truncated: end < lines.len(),
    })
}

fn collect_text_files(root: &Path, directory: &Path, files: &mut Vec<PathBuf>, limit: usize) {
    if files.len() >= limit {
        return;
    }
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        if files.len() >= limit {
            break;
        }
        let path = entry.path();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            let name = entry.file_name();
            if !matches!(name.to_str(), Some(".git" | "node_modules" | "target")) {
                collect_text_files(root, &path, files, limit);
            }
        } else if kind.is_file() && path.starts_with(root) {
            files.push(path);
        }
    }
}

#[tauri::command]
fn search_workspace_text(
    root_path: String,
    path: String,
    query: String,
    limit: usize,
) -> Result<Vec<SearchMatch>, BackendError> {
    if query.is_empty() || query.len() > 1_000 {
        return Err(BackendError::Configuration(
            "search query is invalid".into(),
        ));
    }
    let root = canonical_workspace(&root_path)?;
    let target = safe_workspace_path(&root, &path, true)?;
    let mut files = Vec::new();
    if target.is_file() {
        files.push(target);
    } else {
        collect_text_files(&root, &target, &mut files, 10_000);
    }
    let max_results = limit.clamp(1, 2_000);
    let mut matches = Vec::new();
    for file in files {
        let Ok(metadata) = fs::metadata(&file) else {
            continue;
        };
        if metadata.len() > MAX_TOOL_OUTPUT as u64 {
            continue;
        }
        let Ok(bytes) = fs::read(&file) else { continue };
        if bytes.iter().take(8_192).any(|byte| *byte == 0) {
            continue;
        }
        let Ok(content) = String::from_utf8(bytes) else {
            continue;
        };
        for (index, line) in content.lines().enumerate() {
            if line.contains(&query) {
                matches.push(SearchMatch {
                    path: relative_display(&root, &file),
                    line: index + 1,
                    text: line.chars().take(500).collect(),
                });
                if matches.len() >= max_results {
                    return Ok(matches);
                }
            }
        }
    }
    Ok(matches)
}

#[tauri::command]
fn workspace_file_metadata(root_path: String, path: String) -> Result<FileMetadata, BackendError> {
    let root = canonical_workspace(&root_path)?;
    let file = safe_workspace_path(&root, &path, true)?;
    metadata_value(&root, &file)
}

fn run_git_apply(root: &Path, patch: &str, check: bool, reverse: bool) -> Result<(), BackendError> {
    let mut command = Command::new("git");
    command
        .current_dir(root)
        .arg("apply")
        .arg("--whitespace=nowarn");
    if check {
        command.arg("--check");
    }
    if reverse {
        command.arg("--reverse");
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| BackendError::Command(error.to_string()))?;
    child
        .stdin
        .as_mut()
        .ok_or_else(|| BackendError::Command("git apply stdin unavailable".into()))?
        .write_all(patch.as_bytes())
        .map_err(|error| BackendError::Command(error.to_string()))?;
    let output = child
        .wait_with_output()
        .map_err(|error| BackendError::Command(error.to_string()))?;
    if !output.status.success() {
        return Err(BackendError::Command(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(())
}

#[tauri::command]
fn apply_workspace_patch(root_path: String, patch: String) -> Result<PatchResult, BackendError> {
    if patch.is_empty() || patch.len() > MAX_TOOL_OUTPUT {
        return Err(BackendError::Configuration(
            "patch is empty or too large".into(),
        ));
    }
    let root = canonical_workspace(&root_path)?;
    let changed_paths: Vec<String> = patch
        .lines()
        .filter_map(|line| line.strip_prefix("+++ "))
        .filter(|path| *path != "/dev/null")
        .map(|path| path.strip_prefix("b/").unwrap_or(path).to_string())
        .collect();
    if changed_paths.is_empty() {
        return Err(BackendError::Configuration(
            "patch does not contain a target file".into(),
        ));
    }
    for path in &changed_paths {
        safe_workspace_path(&root, path, false)?;
    }
    run_git_apply(&root, &patch, true, false)?;
    run_git_apply(&root, &patch, false, false)?;
    Ok(PatchResult {
        diff: patch,
        changed_paths,
    })
}

#[tauri::command]
fn revert_workspace_patch(root_path: String, patch: String) -> Result<PatchResult, BackendError> {
    if patch.is_empty() || patch.len() > MAX_TOOL_OUTPUT {
        return Err(BackendError::Configuration(
            "patch is empty or too large".into(),
        ));
    }
    let root = canonical_workspace(&root_path)?;
    let changed_paths: Vec<String> = patch
        .lines()
        .filter_map(|line| line.strip_prefix("+++ "))
        .filter(|path| *path != "/dev/null")
        .map(|path| path.strip_prefix("b/").unwrap_or(path).to_string())
        .collect();
    for path in &changed_paths {
        safe_workspace_path(&root, path, true)?;
    }
    run_git_apply(&root, &patch, true, true)?;
    run_git_apply(&root, &patch, false, true)?;
    Ok(PatchResult {
        diff: patch,
        changed_paths,
    })
}

#[tauri::command]
async fn execute_workspace_shell(
    root_path: String,
    command: String,
    timeout_ms: u64,
) -> Result<ShellResult, BackendError> {
    let root = canonical_workspace(&root_path)?;
    if command.trim().is_empty() || command.len() > 16_384 {
        return Err(BackendError::Configuration("invalid command length".into()));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        #[cfg(target_os = "windows")]
        let mut command_builder = Command::new("cmd");
        #[cfg(target_os = "windows")]
        command_builder.args(["/D", "/S", "/C", &command]);
        #[cfg(not(target_os = "windows"))]
        let mut command_builder = Command::new("/bin/zsh");
        #[cfg(not(target_os = "windows"))]
        command_builder.args(["-lc", &command]);
        let mut child = command_builder
            .current_dir(root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| BackendError::Command(error.to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| BackendError::Command("stdout unavailable".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| BackendError::Command("stderr unavailable".into()))?;
        let stdout_reader = std::thread::spawn(move || {
            let mut value = String::new();
            let mut reader = stdout;
            let _ = reader.read_to_string(&mut value);
            value
        });
        let stderr_reader = std::thread::spawn(move || {
            let mut value = String::new();
            let mut reader = stderr;
            let _ = reader.read_to_string(&mut value);
            value
        });
        let timeout = Duration::from_millis(timeout_ms.clamp(1, 15 * 60_000));
        let (exit_code, timed_out) = loop {
            if let Some(status) = child
                .try_wait()
                .map_err(|error| BackendError::Command(error.to_string()))?
            {
                break (status.code().unwrap_or(-1), false);
            }
            if started.elapsed() >= timeout {
                child
                    .kill()
                    .map_err(|error| BackendError::Command(error.to_string()))?;
                let status = child
                    .wait()
                    .map_err(|error| BackendError::Command(error.to_string()))?;
                break (status.code().unwrap_or(-1), true);
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        let (stdout, stdout_truncated) = truncate_output(stdout_reader.join().unwrap_or_default());
        let (stderr, stderr_truncated) = truncate_output(stderr_reader.join().unwrap_or_default());
        Ok(ShellResult {
            command,
            stdout,
            stderr,
            exit_code,
            duration_ms: started.elapsed().as_millis(),
            timed_out,
            truncated: stdout_truncated || stderr_truncated,
        })
    })
    .await
    .map_err(|error| BackendError::Command(error.to_string()))?
}

#[tauri::command]
async fn check_http_health(url: String, timeout_ms: u64) -> Result<bool, BackendError> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(BackendError::Configuration(
            "health URL must use HTTP or HTTPS".into(),
        ));
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| BackendError::Network(error.to_string()))?;
    Ok(client
        .get(url)
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false))
}

#[tauri::command]
async fn stream_chat(app: AppHandle, request: ChatRequest) -> Result<(), BackendError> {
    if !request.base_url.starts_with("http://") && !request.base_url.starts_with("https://") {
        return Err(BackendError::Configuration(
            "model API URL must use HTTP or HTTPS".into(),
        ));
    }

    let token_event = format!("chat://token/{}", request.request_id);
    let done_event = format!("chat://done/{}", request.request_id);
    let error_event = format!("chat://error/{}", request.request_id);
    let url = format!(
        "{}/chat/completions",
        request.base_url.trim_end_matches('/')
    );
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| BackendError::ModelApi(error.to_string()))?;
    let response = client
        .post(url)
        .json(&json!({
            "model": request.model,
            "temperature": request.temperature,
            "messages": request.messages,
            "stream": true
        }))
        .send()
        .await
        .map_err(|error| BackendError::ModelApi(error.to_string()))?;

    if !response.status().is_success() {
        let message = format!("model API returned {}", response.status());
        app.emit(&error_event, &message).ok();
        return Err(BackendError::ModelApi(message));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| BackendError::ModelApi(error.to_string()))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(newline) = buffer.find('\n') {
            let line = buffer[..newline].trim().to_string();
            buffer.drain(..=newline);
            let Some(data) = line.strip_prefix("data:").map(str::trim) else {
                continue;
            };
            if data == "[DONE]" {
                app.emit(&done_event, ()).ok();
                return Ok(());
            }
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(token) = value["choices"][0]["delta"]["content"].as_str() {
                    app.emit(&token_event, token).ok();
                }
            }
        }
    }
    let message = "SSE stream ended before the [DONE] marker";
    app.emit(&error_event, message).ok();
    Err(BackendError::ModelApi(message.into()))
}

#[tauri::command]
async fn complete_agent(
    base_url: String,
    model: String,
    temperature: f32,
    system: String,
    task: String,
    steps: serde_json::Value,
    tools: serde_json::Value,
) -> Result<serde_json::Value, BackendError> {
    if !base_url.starts_with("http://127.0.0.1:") && !base_url.starts_with("http://localhost:") {
        return Err(BackendError::Configuration(
            "agent model API must use the local SSH tunnel".into(),
        ));
    }
    let definitions = tools.as_array().cloned().unwrap_or_default().into_iter().map(|tool| {
        json!({
            "type": "function",
            "function": {
                "name": tool.get("name").cloned().unwrap_or(serde_json::Value::Null),
                "description": tool.get("description").cloned().unwrap_or(serde_json::Value::Null),
                "parameters": tool.get("inputSchema").cloned().unwrap_or_else(|| json!({"type":"object"}))
            }
        })
    }).collect::<Vec<_>>();
    let mut step_context = steps.to_string();
    if step_context.len() > MAX_AGENT_STEP_CONTEXT {
        let mut boundary = MAX_AGENT_STEP_CONTEXT;
        while !step_context.is_char_boundary(boundary) {
            boundary -= 1;
        }
        step_context.truncate(boundary);
        step_context.push_str("...[agent step context truncated]");
    }
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let response = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| BackendError::ModelApi(error.to_string()))?
        .post(url)
        .json(&json!({
            "model": model,
            "temperature": temperature,
            "messages": [
                {"role":"system", "content":system},
                {"role":"user", "content":task},
                {"role":"system", "content":format!("Previous agent steps: {}", step_context)}
            ],
            "tools": definitions,
            "tool_choice": "auto",
            "stream": false
        }))
        .send()
        .await
        .map_err(|error| BackendError::ModelApi(error.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(BackendError::ModelApi(format!(
            "model API returned {status}"
        )));
    }
    response
        .json()
        .await
        .map_err(|error| BackendError::ModelApi(error.to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            check_host,
            send_magic_packet,
            execute_custom_wake,
            check_ssh,
            execute_ssh,
            start_ssh_tunnel,
            stop_ssh_tunnel,
            start_remote_runtime,
            inspect_remote_runtime,
            stop_remote_runtime,
            store_credential,
            validate_workspace,
            list_workspace_directory,
            read_workspace_file,
            search_workspace_text,
            workspace_file_metadata,
            apply_workspace_patch,
            revert_workspace_patch,
            execute_workspace_shell,
            check_http_health,
            stream_chat,
            complete_agent
        ])
        .run(tauri::generate_context!())
        .expect("error while running Local LLM Client");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_workspace_parent_traversal() {
        let root = std::env::temp_dir();
        assert!(safe_workspace_path(&root, "../secret", false).is_err());
        assert!(safe_workspace_path(&root, "/etc/passwd", false).is_err());
    }

    #[test]
    fn quotes_powershell_arguments_without_command_breakout() {
        assert_eq!(powershell_quote("a'b"), "'a''b'");
    }

    #[test]
    fn parses_common_mac_address_formats() {
        assert_eq!(
            parse_mac_address("AA:BB:CC:DD:EE:FF").unwrap(),
            [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]
        );
        assert!(parse_mac_address("invalid").is_err());
    }
}
