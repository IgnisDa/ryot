use std::sync::Arc;

use anyhow::Result;
use chrono::{Days, Utc};
use common_models::{ApplicationCacheKey, UserLevelCacheKey, YoutubeMusicSyncedForUser};
use common_utils::TEMP_DIR;
use dependent_models::{ApplicationCacheValue, EmptyCacheValue, ImportResult};
use rustypipe::client::RustyPipe;
use supporting_service::SupportingService;

pub async fn yank_progress(
    auth_cookie: String,
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<ImportResult> {
    let date = Utc::now()
        .checked_sub_days(Days::new(1))
        .unwrap()
        .date_naive();
    let cache_key = ApplicationCacheKey::YoutubeMusicSyncedForUser(UserLevelCacheKey {
        user_id: user_id.to_owned(),
        input: YoutubeMusicSyncedForUser { date },
    });
    if let Some(_) = ss
        .cache_service
        .get_value::<EmptyCacheValue>(cache_key.clone())
        .await
    {
        return Ok(ImportResult::default());
    }
    let client = RustyPipe::builder().storage_dir(TEMP_DIR).build().unwrap();
    client.set_auth_cookie(auth_cookie).await;
    let a = client
        .query()
        .authenticated()
        .music_history()
        .await
        .unwrap();
    dbg!(a);
    ss.cache_service
        .set_key(
            cache_key,
            ApplicationCacheValue::Empty(EmptyCacheValue::default()),
        )
        .await
        .unwrap();
    Ok(ImportResult::default())
}
