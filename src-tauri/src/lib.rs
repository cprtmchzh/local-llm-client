use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use ssh2::Session;
use std::{
    net::{SocketAddr, TcpStream, ToSocketAddrs, UdpSocket},
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use thiserror::Error;

const SSH_PASSWORD_SERVICE: &str = "local-llm-client.ssh";
const SSH_KEY_SERVICE: &str = "local-llm-client.ssh-key";

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
        let address: SocketAddr = broadcast_address
            .parse()
            .map_err(|_| BackendError::Configuration("broadcast address must include a port".into()))?;
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
            let password = keychain_secret(SSH_PASSWORD_SERVICE, &connection.username)
                .ok_or_else(|| BackendError::Credential("SSH password is not in Keychain".into()))?;
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
        return Err(BackendError::Authentication("server rejected credentials".into()));
    }
    Ok(session)
}

#[tauri::command]
async fn check_ssh(connection: SshConnection) -> Result<(), BackendError> {
    tauri::async_runtime::spawn_blocking(move || open_ssh(&connection).map(|_| ()))
        .await
        .map_err(|error| BackendError::Network(error.to_string()))?
}

#[tauri::command]
async fn execute_ssh(connection: SshConnection, command: String) -> Result<String, BackendError> {
    if command.trim().is_empty() || command.len() > 16_384 {
        return Err(BackendError::Configuration("invalid remote command length".into()));
    }
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        let session = open_ssh(&connection)?;
        let mut channel = session
            .channel_session()
            .map_err(|error| BackendError::Command(error.to_string()))?;
        channel
            .exec(&command)
            .map_err(|error| BackendError::Command(error.to_string()))?;
        let mut output = String::new();
        channel
            .read_to_string(&mut output)
            .map_err(|error| BackendError::Command(error.to_string()))?;
        channel
            .wait_close()
            .map_err(|error| BackendError::Command(error.to_string()))?;
        let status = channel
            .exit_status()
            .map_err(|error| BackendError::Command(error.to_string()))?;
        if status != 0 {
            return Err(BackendError::Command(format!(
                "remote process exited with {status}: {}",
                output.trim()
            )));
        }
        Ok(output)
    })
    .await
    .map_err(|error| BackendError::Command(error.to_string()))?
}

#[tauri::command]
fn store_credential(service: String, account: String, secret: String) -> Result<(), BackendError> {
    if !matches!(service.as_str(), SSH_PASSWORD_SERVICE | SSH_KEY_SERVICE) {
        return Err(BackendError::Configuration("credential service is not allowed".into()));
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
    let url = format!("{}/chat/completions", request.base_url.trim_end_matches('/'));
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
    app.emit(&done_event, ()).ok();
    Ok(())
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
            store_credential,
            check_http_health,
            stream_chat
        ])
        .run(tauri::generate_context!())
        .expect("error while running Local LLM Client");
}
