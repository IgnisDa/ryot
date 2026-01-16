use cargo_toml::Manifest;
use std::{env, fs, path::Path};

fn main() {
    println!("cargo:rerun-if-changed=../../Cargo.toml");

    let manifest =
        Manifest::from_path("../../Cargo.toml").expect("Failed to parse workspace Cargo.toml");

    let workspace_crates: Vec<String> = manifest
        .workspace
        .expect("No workspace found")
        .dependencies
        .into_iter()
        .filter(|(_, dep)| dep.detail().map(|d| d.path.is_some()).unwrap_or(false))
        .map(|(name, _)| name.replace("-", "_"))
        .collect();

    let out_dir = env::var("OUT_DIR").unwrap();
    let dest_path = Path::new(&out_dir).join("workspace_crates.rs");

    let contents = format!(
        "pub const WORKSPACE_CRATES: &[&str] = &[{}];",
        workspace_crates
            .iter()
            .map(|s| format!("\"{}\"", s))
            .collect::<Vec<_>>()
            .join(", ")
    );

    fs::write(dest_path, contents).unwrap();
}
