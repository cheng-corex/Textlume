mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Check if another instance is already running
    let args: Vec<String> = std::env::args().collect();
    let file_paths: Vec<String> = args
        .iter()
        .skip(1)
        .filter(|arg| std::path::Path::new(arg).exists() && std::path::Path::new(arg).is_file())
        .cloned()
        .collect();

    match commands::single_instance::try_become_primary() {
        Err(_existing_port) => {
            // Another instance is running - forward file paths to it
            let listener_port_file = std::env::temp_dir().join("textlume.listener");
            if let Ok(port_str) = std::fs::read_to_string(&listener_port_file) {
                if let Ok(listener_port) = port_str.trim().parse::<u16>() {
                    if !file_paths.is_empty() {
                        for path in &file_paths {
                            commands::single_instance::send_to_existing(listener_port, path);
                        }
                    }
                }
            }
            std::process::exit(0);
        }
        Ok(_port) => {
            // We're the first instance, continue
        }
    }

    // Write startup file paths to temp file so the frontend can read them reliably
    if !file_paths.is_empty() {
        let startup_file = std::env::temp_dir().join("textlume.startup");
        std::fs::write(&startup_file, file_paths.join("\n")).ok();
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                commands::recovery::clear_all_recovery_drafts_internal();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::file::open_file,
            commands::file::save_file,
            commands::file::list_directory,
            commands::file::rename_file,
            commands::file::create_file,
            commands::file::create_directory,
            commands::file::delete_file_or_dir,
            commands::file::move_file_or_dir,
            commands::file::copy_file_or_dir,
            commands::file::get_recent_files,
            commands::file::add_recent_file,
            commands::file::get_startup_files,
            commands::file::save_session_files,
            commands::file::get_session_files,
            commands::file::reveal_in_explorer,
            commands::search::search_in_files,
            commands::recovery::save_recovery_draft,
            commands::recovery::list_recovery_drafts,
            commands::recovery::clear_recovery_draft,
            commands::recovery::clear_all_recovery_drafts,
            commands::single_instance::drain_pending,
        ])
        .setup(|_app| {
            // Start listener for incoming file paths from other instances
            commands::single_instance::start_listener();
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {});
}