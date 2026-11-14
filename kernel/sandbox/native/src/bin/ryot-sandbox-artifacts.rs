use std::error::Error;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const OUT_DIR: &str = env!("OUT_DIR");

fn install_executable(source: &Path, destination: &Path) -> io::Result<()> {
    let temporary = destination.with_extension(format!("{}.tmp", std::process::id()));
    let mut staged = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    let result = (|| {
        let mut input = fs::File::open(source)?;
        io::copy(&mut input, &mut staged)?;
        staged.set_permissions(input.metadata()?.permissions())?;
        drop(staged);
        // macOS caches executable signatures by inode; never overwrite a published executable.
        fs::rename(&temporary, destination)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
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
        install_executable(&release_dir.join(name), &output.join(name))?;
    }

    for file in fs::read_dir(OUT_DIR)? {
        let path = file?.path();
        if path
            .extension()
            .is_some_and(|extension| extension == "snap")
        {
            fs::copy(&path, snapshots.join(path.file_name().expect("file name")))?;
        }
    }

    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    export()
}

#[cfg(test)]
mod tests {
    use super::install_executable;
    use std::fs;
    use std::io::Read;

    #[test]
    fn replaces_the_executable_without_changing_existing_readers() {
        let directory = std::env::temp_dir().join(format!(
            "ryot-sandbox-artifact-install-{}",
            std::process::id()
        ));
        fs::create_dir(&directory).unwrap();
        let source = directory.join("source");
        let destination = directory.join("installed");
        fs::write(&source, b"new executable").unwrap();
        fs::write(&destination, b"old executable").unwrap();
        let mut previous = fs::File::open(&destination).unwrap();

        install_executable(&source, &destination).unwrap();

        let mut retained = String::new();
        previous.read_to_string(&mut retained).unwrap();
        assert_eq!(retained, "old executable");
        assert_eq!(fs::read(&destination).unwrap(), b"new executable");
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 2);
        fs::remove_dir_all(directory).unwrap();
    }
}
