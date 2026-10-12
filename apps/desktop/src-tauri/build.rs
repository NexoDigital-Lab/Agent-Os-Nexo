fn main() {
    // App commands need generated permissions: set_page_zoom is called from the remote page, retry_start and
    // open_log from the splash shown while the server boots or when it fails.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["set_page_zoom", "retry_start", "open_log"]),
        ),
    )
    .expect("failed to run tauri-build");
}
