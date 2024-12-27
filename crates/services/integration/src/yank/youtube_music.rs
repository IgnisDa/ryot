use anyhow::Result;
use common_utils::TEMP_DIR;
use dependent_models::ImportResult;
use rustypipe::client::RustyPipe;

pub async fn yank_progress(auth_cookie: String) -> Result<ImportResult> {
    let client = RustyPipe::builder().storage_dir(TEMP_DIR).build().unwrap();
    client.set_auth_cookie(auth_cookie).await;
    let a = client
        .query()
        .authenticated()
        .music_history()
        .await
        .unwrap();
    dbg!(a);
    Ok(ImportResult::default())
}
