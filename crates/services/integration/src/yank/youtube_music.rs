use std::sync::Arc;

use anyhow::Result;
use chrono::Utc;
use common_models::{ApplicationCacheKey, UserLevelCacheKey, YoutubeMusicSongListened};
use common_utils::TEMP_DIR;
use dependent_models::{ApplicationCacheValue, EmptyCacheValue, ImportCompletedItem, ImportResult};
use enum_models::{MediaLot, MediaSource};
use media_models::{ImportOrExportMetadataItem, ImportOrExportMetadataItemSeen};
use rustypipe::client::RustyPipe;
use supporting_service::SupportingService;

// DEV: Youtube music only returns one record regardless of how many time you have listened
// to it that day. We abuse this fact and for each day, we cache when this user listened to
// a particular song along with the date. Next time, if the song is already cached, we do
// not return it. This also allows us to get the rough time around when the user listened
// to the song.
pub async fn yank_progress(
    auth_cookie: String,
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<ImportResult> {
    let date = Utc::now().date_naive();
    let client = RustyPipe::builder().storage_dir(TEMP_DIR).build().unwrap();
    client.set_auth_cookie(auth_cookie).await;
    let music_history = client
        .query()
        .authenticated()
        .music_history()
        .await
        .unwrap();
    let mut result = ImportResult::default();
    for item in music_history.items.into_iter().rev() {
        let cache_key = ApplicationCacheKey::YoutubeMusicSongListened(UserLevelCacheKey {
            user_id: user_id.to_owned(),
            input: YoutubeMusicSongListened {
                listened_on: date,
                id: item.id.clone(),
            },
        });
        if ss
            .cache_service
            .get_value::<EmptyCacheValue>(cache_key.clone())
            .await
            .is_some()
        {
            continue;
        }
        result
            .completed
            .push(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
                identifier: item.id,
                lot: MediaLot::Music,
                source: MediaSource::YoutubeMusic,
                seen_history: vec![ImportOrExportMetadataItemSeen {
                    provider_watched_on: Some("Youtube Music".to_owned()),
                    ..Default::default()
                }],
                ..Default::default()
            }));
        ss.cache_service
            .set_key(
                cache_key,
                ApplicationCacheValue::Empty(EmptyCacheValue::default()),
            )
            .await
            .unwrap();
    }
    Ok(result)
}
