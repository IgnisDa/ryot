use std::sync::Arc;

use anyhow::Result;
use chrono::Utc;
use common_models::{ApplicationCacheKey, UserLevelCacheKey, YoutubeMusicSongListened};
use common_utils::TEMP_DIR;
use dependent_models::{ApplicationCacheValue, EmptyCacheValue, ImportCompletedItem, ImportResult};
use enum_models::{MediaLot, MediaSource};
use itertools::Itertools;
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
    let songs_listened_to_today = music_history
        .items
        .into_iter()
        .rev()
        .map(|item| item.id)
        .collect_vec();
    let cache_keys = songs_listened_to_today
        .iter()
        .map(|id| {
            (
                id.clone(),
                ApplicationCacheKey::YoutubeMusicSongListened(UserLevelCacheKey {
                    user_id: user_id.to_owned(),
                    input: YoutubeMusicSongListened {
                        id: id.clone(),
                        listened_on: date,
                    },
                }),
            )
        })
        .collect_vec();
    let items_in_cache = ss
        .cache_service
        .get_values(cache_keys.iter().map(|(_id, key)| key.clone()).collect())
        .await
        .unwrap_or_default();
    let songs_to_process = cache_keys
        .iter()
        .filter(|(_id, key)| !items_in_cache.contains_key(key))
        .map(|(id, _key)| id)
        .collect_vec();
    let mut result = ImportResult::default();
    for item in songs_to_process {
        result
            .completed
            .push(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
                lot: MediaLot::Music,
                identifier: item.to_owned(),
                source: MediaSource::YoutubeMusic,
                seen_history: vec![ImportOrExportMetadataItemSeen {
                    provider_watched_on: Some(MediaSource::YoutubeMusic.to_string()),
                    ..Default::default()
                }],
                ..Default::default()
            }));
    }
    ss.cache_service
        .set_keys(
            cache_keys
                .into_iter()
                .map(|(_id, key)| {
                    (
                        key,
                        ApplicationCacheValue::Empty(EmptyCacheValue::default()),
                    )
                })
                .collect(),
        )
        .await
        .ok();
    Ok(result)
}
