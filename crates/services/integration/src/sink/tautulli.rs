use std::fs;

use anyhow::Result;
use dependent_models::ImportResult;

pub async fn yank_progress(payload: String) -> Result<ImportResult> {
    fs::write("tautulli.json", payload)?;
    todo!()
}
