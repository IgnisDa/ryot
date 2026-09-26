use std::error::Error;
use std::fs;
use std::io;
use std::path::PathBuf;

const OUT_DIR: &str = env!("OUT_DIR");

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
