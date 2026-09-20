use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use application_utils::{get_current_date, get_current_time};
use chrono::{Duration, NaiveDate, NaiveDateTime, Offset, Utc};
use chrono_tz::Tz;
use common_models::{UserLevelCacheKey, YoutubeMusicSongListened};
use common_utils::{get_temporary_directory, ryot_log};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, ImportCompletedItem, ImportOrExportMetadataItem,
    ImportResult,
};
use enum_models::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::ImportOrExportMetadataItemSeen;
use rust_decimal::dec;
use rustypipe::client::RustyPipe;
use supporting_service::SupportingService;

static THRESHOLD_MINUTES: i64 = 10;

fn get_end_of_day(date: NaiveDate) -> NaiveDateTime {
    date.and_hms_opt(23, 59, 59).unwrap()
}

fn get_offset(timezone: &str) -> i16 {
    let utc_now = Utc::now();
    let parsed = timezone.parse::<Tz>().unwrap();
    let local_time = utc_now.with_timezone(&parsed);
    let offset = local_time.offset().fix().local_minus_utc() / 60;
    offset.try_into().unwrap()
}

// DEV: Youtube music only returns one record regardless of how many time you have listened
// to it that day. It also does not include what time the song was listened to. So, for
// each song listened to today, we cache the song id with `is_complete=false` and return
// `progress=35%`. Next time, if the song is already cached, we change the cache to
// `is_complete=true` and return `progress=100%`. Thus the music gets marked as complete
// and gets the correct start and end date marked. When the song appears again that day, we
// silently ignore it since it is already in the cache as completely synced.
//
// Also, 10 minutes before the end of the day, we do not deploy the 35% progress since it
// messes up with the caching mechanism which works on the current date.
pub async fn yank_progress(
    user_id: &String,
    timezone: String,
    auth_cookie: String,
    ss: &Arc<SupportingService>,
) -> Result<ImportResult> {
    let timezone_internal: chrono_tz::Tz = timezone.parse().unwrap();
    let date = get_current_date(&timezone_internal);
    let current_time = get_current_time(&timezone_internal);
    let end_of_day = get_end_of_day(date);
    let is_within_threshold =
        end_of_day.signed_duration_since(current_time) <= Duration::minutes(THRESHOLD_MINUTES);

    let client = RustyPipe::builder()
        .storage_dir(get_temporary_directory())
        .timezone(&timezone, get_offset(&timezone))
        .build()?;
    client.user_auth_set_cookie(auth_cookie).await?;
    let music_history = client.query().authenticated().music_history().await?;
    let songs_listened_to_today = music_history
        .items
        .into_iter()
        .rev()
        .filter_map(|history| {
            history.playback_date_txt.and_then(|d| match d.as_str() {
                "Today" => Some((history.item.id, history.item.name)),
                _ => None,
            })
        })
        .collect_vec();
    ryot_log!(debug, "Songs listened today: {:?}", songs_listened_to_today);
    let cache_keys = songs_listened_to_today
        .clone()
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
    let items_in_cache = cache_service::get_values(ss, cache_keys.values().cloned().collect())
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|(k, v)| (k, v.value))
        .collect::<HashMap<_, _>>();
    let mut result = ImportResult::default();
    let mut items_to_cache = vec![];
    for (song_id, name) in songs_listened_to_today {
        let Some(cache_key) = cache_keys.get(&song_id) else {
            continue;
        };
        let (cache_value, progress) = match items_in_cache.get(cache_key) {
            None if !is_within_threshold => (
                ApplicationCacheValue::YoutubeMusicSongListened(false),
                dec!(35),
            ),
            Some(ApplicationCacheValue::YoutubeMusicSongListened(is_complete)) if !is_complete => (
                ApplicationCacheValue::YoutubeMusicSongListened(true),
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
                    providers_consumed_on: Some(vec!["Youtube Music".to_owned()]),
                    ..Default::default()
                }],
                source: MediaSource::YoutubeMusic,
                ..Default::default()
            }));
        items_to_cache.push((cache_key.to_owned(), cache_value));
    }
    cache_service::set_keys(ss, items_to_cache).await.ok();
    Ok(result)
}
