use std::collections::HashMap;
use std::path::Path;

use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::protocol::Tier;

const MANIFEST: &str = include_str!(concat!(env!("OUT_DIR"), "/snapshots.json"));

#[derive(Deserialize)]
struct ManifestEntry {
    file: String,
    sha256: String,
    imports: HashMap<String, String>,
}

pub struct Snapshot {
    pub bytes: &'static [u8],
    pub imports: HashMap<String, String>,
}

impl Snapshot {
    pub fn load(directory: &Path, tier: Tier) -> Result<Self, String> {
        let mut manifest: HashMap<Tier, ManifestEntry> = serde_json::from_str(MANIFEST)
            .map_err(|error| format!("snapshot manifest: {error}"))?;
        let entry = manifest
            .remove(&tier)
            .ok_or_else(|| format!("snapshot manifest is missing {tier:?}"))?;
        let path = directory.join(&entry.file);
        let bytes = std::fs::read(&path).map_err(|error| format!("{}: {error}", path.display()))?;
        let digest = format!("{:x}", Sha256::digest(&bytes));
        if digest != entry.sha256 {
            return Err(format!(
                "{} digest {digest} does not match the manifest digest {}",
                path.display(),
                entry.sha256
            ));
        }
        Ok(Self {
            bytes: Box::leak(bytes.into_boxed_slice()),
            imports: entry.imports,
        })
    }
}
