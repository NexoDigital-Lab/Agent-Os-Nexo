fn main() {
    // set_page_zoom is an app command called from the remote page, so it needs a generated permission.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["set_page_zoom"])),
    )
    .expect("failed to run tauri-build");
}
