use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;

fn port_file_path() -> PathBuf {
    std::env::temp_dir().join("textlume.port")
}

/// Try to become the primary instance. Returns Ok if we're the first instance,
/// Err if another instance is already running.
pub fn try_become_primary() -> Result<u16, u16> {
    match TcpListener::bind("127.0.0.1:0") {
        Ok(listener) => {
            let port = listener.local_addr().unwrap().port();
            std::fs::write(port_file_path(), port.to_string()).ok();
            // Keep the port bound so other instances can't claim it
            std::thread::spawn(move || {
                for _ in listener.incoming() {}
            });
            Ok(port)
        }
        Err(_) => {
            // Couldn't bind - another instance is already running
            if let Ok(port_str) = std::fs::read_to_string(port_file_path()) {
                if let Ok(port) = port_str.trim().parse::<u16>() {
                    return Err(port);
                }
            }
            // If we can't even read the port file, something went wrong
            Err(0)
        }
    }
}

/// Send a file path to the existing instance's listener.
pub fn send_to_existing(listener_port: u16, file_path: &str) -> bool {
    match TcpStream::connect(format!("127.0.0.1:{}", listener_port)) {
        Ok(mut stream) => stream.write_all(file_path.as_bytes()).is_ok(),
        Err(_) => false,
    }
}

/// Start listening for incoming file paths from other instances.
pub fn start_listener() -> Option<u16> {
    match TcpListener::bind("127.0.0.1:0") {
        Ok(listener) => {
            let port = listener.local_addr().unwrap().port();
            let listener_port_file = std::env::temp_dir().join("textlume.listener");
            std::fs::write(&listener_port_file, port.to_string()).ok();

            std::thread::spawn(move || {
                for stream in listener.incoming() {
                    if let Ok(mut stream) = stream {
                        let mut buf = String::new();
                        if stream.read_to_string(&mut buf).is_ok() {
                            let path = buf.trim().to_string();
                            if !path.is_empty() {
                                let pending_file = std::env::temp_dir().join("textlume.pending");
                                let existing = std::fs::read_to_string(&pending_file).unwrap_or_default();
                                let new_content = if existing.is_empty() {
                                    path
                                } else {
                                    format!("{}\n{}", existing, path)
                                };
                                std::fs::write(&pending_file, new_content).ok();
                            }
                        }
                    }
                }
            });
            Some(port)
        }
        Err(_) => None,
    }
}

/// Read and clear pending file paths
#[tauri::command]
pub fn drain_pending() -> Vec<String> {
    let pending_file = std::env::temp_dir().join("textlume.pending");
    if let Ok(content) = std::fs::read_to_string(&pending_file) {
        let _ = std::fs::remove_file(&pending_file);
        content.lines().map(|s| s.to_string()).filter(|s| !s.is_empty()).collect()
    } else {
        Vec::new()
    }
}