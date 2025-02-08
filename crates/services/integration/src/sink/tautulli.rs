use std::fs;

use anyhow::Result;
use chrono::Utc;
use dependent_models::ImportResult;

pub async fn yank_progress(payload: String) -> Result<ImportResult> {
    fs::write(&format!("tautulli-{}.json", Utc::now()), payload)?;
    todo!()
}
