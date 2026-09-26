use std::collections::BTreeMap;
use std::error::Error;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use sha2::{Digest, Sha256};

const OUT_DIR: &str = env!("OUT_DIR");
const SNAPSHOTS: [(&str, &str); 3] = [
    ("core", "core.snap"),
    ("data", "data.snap"),
    ("full", "full.snap"),
];

#[derive(Deserialize)]
struct ManifestEntry {
    file: String,
    sha256: String,
}

fn export() -> Result<(), Box<dyn Error>> {
    let mut args = std::env::args_os().skip(1);
    let output = args.next().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "usage: ryot-sandbox-artifacts <output-directory>",
        )
    })?;
    if args.next().is_some() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "expected exactly one output directory",
        )
        .into());
    }

    let output = PathBuf::from(output);
    let snapshots = output.join("snapshots");
    fs::create_dir_all(&snapshots)?;

    let release_dir = std::env::current_exe()?
        .parent()
        .ok_or_else(|| io::Error::other("current executable has no parent directory"))?
        .to_path_buf();
    for name in ["ryot-sandboxd", "ryot-sandbox-launcher"] {
        fs::copy(release_dir.join(name), output.join(name))?;
    }

    let manifest_path = snapshots.join("snapshots.json");
    fs::copy(Path::new(OUT_DIR).join("snapshots.json"), &manifest_path)?;
    let manifest: BTreeMap<String, ManifestEntry> =
        serde_json::from_slice(&fs::read(&manifest_path)?)?;

    for (tier, filename) in SNAPSHOTS {
        let entry = manifest.get(tier).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("snapshot manifest is missing {tier}"),
            )
        })?;
        if entry.file != filename {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "snapshot manifest entry {tier} names unexpected file {}",
                    entry.file
                ),
            )
            .into());
        }

        let destination = snapshots.join(filename);
        fs::copy(Path::new(OUT_DIR).join(filename), &destination)?;
        validate_snapshot(&destination, &fs::read(&destination)?, &entry.sha256)?;
    }

    Ok(())
}

fn validate_snapshot(path: &Path, bytes: &[u8], expected: &str) -> io::Result<()> {
    let actual = format!("{:x}", Sha256::digest(bytes));
    if actual != expected {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "{} digest {actual} does not match the manifest digest {expected}",
                path.display()
            ),
        ));
    }
    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    export()
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use sha2::{Digest, Sha256};

    use super::validate_snapshot;

    #[test]
    fn rejects_exported_snapshot_bytes_that_do_not_match_the_manifest() {
        let expected = format!("{:x}", Sha256::digest(b"original snapshot"));

        assert!(
            validate_snapshot(Path::new("core.snap"), b"tampered snapshot", &expected).is_err()
        );
    }
}
