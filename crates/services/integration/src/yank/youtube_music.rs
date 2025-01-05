use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use chrono::{NaiveDate, Utc};
use common_models::{ApplicationCacheKey, UserLevelCacheKey, YoutubeMusicSongListened};
use common_utils::TEMP_DIR;
use dependent_models::{
    ApplicationCacheValue, ImportCompletedItem, ImportResult, YoutubeMusicSongListenedResponse,
};
use enum_models::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{ImportOrExportMetadataItem, ImportOrExportMetadataItemSeen};
use rust_decimal_macros::dec;
use rustypipe::client::RustyPipe;
use supporting_service::SupportingService;

// DEV: Youtube music only returns one record regardless of how many time you have listened
// to it that day. For each song listened to today, we cache the song id with
// `is_complete=false` and return `progress=35%`. Next time, if the song is already cached,
// we change the cache to `is_complete=true` and return the `progress=100%`. Thus the music
// gets marked as complete and gets the correct start and end date marked. When the song
// appears again that day, we silently ignore it since it is already in the cache as
// completely synced.
pub async fn yank_progress(
    auth_cookie: String,
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<ImportResult> {
    let date = Utc::now().date_naive();
    let client = RustyPipe::builder().storage_dir(TEMP_DIR).build().unwrap();
    client.user_auth_set_cookie(auth_cookie).await?;
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
        .filter_map(|history| {
            history.playback_date.and_then(|d| {
                let yt_date =
                    NaiveDate::from_ymd_opt(d.year(), d.month() as u32, d.day().into()).unwrap();
                match yt_date == date {
                    true => Some((history.item.id, history.item.name)),
                    false => None,
                }
            })
        })
        .collect_vec();
    let cache_keys = songs_listened_to_today
        .iter()
        .map(|(id, _)| {
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
        .collect::<HashMap<_, _>>();
    let items_in_cache = ss
        .cache_service
        .get_values(cache_keys.iter().map(|(_id, key)| key.clone()).collect())
        .await
        .unwrap_or_default();
    let mut result = ImportResult::default();
    let mut items_to_cache = vec![];
    for (song_id, name) in songs_listened_to_today {
        let Some(cache_key) = cache_keys.get(&song_id) else {
            continue;
        };
        let (cache_value, progress) = match items_in_cache.get(cache_key) {
            None => (
                ApplicationCacheValue::YoutubeMusicSongListened(YoutubeMusicSongListenedResponse {
                    is_complete: false,
                }),
                dec!(35),
            ),
            Some(ApplicationCacheValue::YoutubeMusicSongListened(
                YoutubeMusicSongListenedResponse { is_complete },
            )) if !is_complete => (
                ApplicationCacheValue::YoutubeMusicSongListened(YoutubeMusicSongListenedResponse {
                    is_complete: true,
                }),
                dec!(100),
            ),
            _ => continue,
        };
        result
            .completed
            .push(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
                source_id: name,
                identifier: song_id,
                lot: MediaLot::Music,
                seen_history: vec![ImportOrExportMetadataItemSeen {
                    progress: Some(progress),
                    provider_watched_on: Some("Youtube Music".to_owned()),
                    ..Default::default()
                }],
                source: MediaSource::YoutubeMusic,
                ..Default::default()
            }));
        items_to_cache.push((cache_key.to_owned(), cache_value));
    }
    ss.cache_service.set_keys(items_to_cache).await.ok();
    Ok(result)
}
