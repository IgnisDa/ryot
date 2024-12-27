use anyhow::Result;
use dependent_models::ImportResult;

pub async fn yank_progress(auth_cookie: String) -> Result<ImportResult> {
    Ok(ImportResult::default())
}
