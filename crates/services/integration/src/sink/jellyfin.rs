use anyhow::{Result, anyhow};
use dependent_models::{ImportCompletedItem, ImportOrExportMetadataItem, ImportResult};
use enum_models::{MediaLot, MediaSource};
use media_models::ImportOrExportMetadataItemSeen;
use rust_decimal::{Decimal, dec};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::jellyfin_official;

mod models {
    use super::*;

    #[derive(Serialize, Deserialize, Debug, Clone)]
    #[serde(rename_all = "PascalCase")]
    pub struct JellyfinWebhookSessionPlayStatePayload {
        pub position_ticks: Option<Decimal>,
    }
    #[derive(Serialize, Deserialize, Debug, Clone)]
    #[serde(rename_all = "PascalCase")]
    pub struct JellyfinWebhookSessionPayload {
        pub play_state: JellyfinWebhookSessionPlayStatePayload,
    }
    #[derive(Serialize, Deserialize, Debug, Clone)]
    #[serde(rename_all = "PascalCase")]
    pub struct JellyfinWebhookItemProviderIdsPayload {
        pub tmdb: Option<String>,
        pub tvdb: Option<String>,
    }
    #[derive(Serialize, Deserialize, Debug, Clone)]
    #[serde(rename_all = "PascalCase")]
    pub struct JellyfinWebhookItemPayload {
        #[serde(rename = "Type")]
        pub item_type: String,
        #[serde(rename = "ParentIndexNumber")]
        pub season_number: Option<i32>,
        #[serde(rename = "IndexNumber")]
        pub episode_number: Option<i32>,
        pub run_time_ticks: Option<Decimal>,
        pub provider_ids: JellyfinWebhookItemProviderIdsPayload,
    }
    #[derive(Serialize, Deserialize, Debug, Clone)]
    #[serde(rename_all = "PascalCase")]
    pub struct JellyfinWebhookUserPayload {
        pub name: Option<String>,
    }
    #[derive(Serialize, Deserialize, Debug, Clone)]
    #[serde(rename_all = "PascalCase")]
    pub struct JellyfinWebhookPayload {
        pub event: Option<String>,
        pub item: JellyfinWebhookItemPayload,
        pub user: Option<JellyfinWebhookUserPayload>,
        pub series: Option<JellyfinWebhookItemPayload>,
        pub session: Option<JellyfinWebhookSessionPayload>,
    }
}

/// Detect an official-plugin flat payload by the presence of a `NotificationType` key.
fn has_notification_type(value: &Value) -> bool {
    value
        .as_object()
        .is_some_and(|m| m.keys().any(|k| k.eq_ignore_ascii_case("NotificationType")))
}

/// Look up a key in a JSON object without regard to letter case.
fn get_ci<'a>(map: &'a serde_json::Map<String, Value>, key: &str) -> Option<&'a Value> {
    map.get(key).or_else(|| {
        map.iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v)
    })
}

/// Get a nested object field without regard to letter case.
fn child<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.as_object().and_then(|m| get_ci(m, key))
}

/// Coerce a JSON value into a trimmed, non-empty string.
fn as_string(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => {
            let trimmed = s.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_owned())
        }
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

/// Coerce a JSON value into a bool, accepting bools and common spellings.
fn as_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(b) => Some(*b),
        Value::Number(n) => n.as_i64().map(|v| v != 0),
        Value::String(s) => match s.trim().to_lowercase().as_str() {
            "true" | "1" | "yes" | "y" => Some(true),
            "false" | "0" | "no" | "n" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

/// Extract the top-level event name, if any.
fn event_name(value: &Value) -> Option<String> {
    value
        .as_object()
        .and_then(|m| get_ci(m, "Event"))
        .and_then(as_string)
}

/// Check whether a nested payload marks media as played via `Item.UserData.Played`.
fn played_flag(value: &Value) -> bool {
    child(value, "Item")
        .and_then(|i| child(i, "UserData"))
        .and_then(|u| child(u, "Played"))
        .and_then(as_bool)
        .unwrap_or(false)
}

/// Extract the username from a nested payload, if any.
fn nested_username(value: &Value) -> Option<String> {
    child(value, "User")
        .and_then(|u| u.as_object())
        .and_then(|m| get_ci(m, "Name"))
        .and_then(as_string)
}

/// Extract a provider id from the nested `Item` section only.
fn item_provider_id(value: &Value, provider: &str) -> Option<String> {
    child(value, "Item")
        .and_then(|i| child(i, "ProviderIds"))
        .and_then(Value::as_object)
        .and_then(|m| get_ci(m, provider))
        .and_then(as_string)
}

/// Extract a provider id from the nested `Series` section only.
fn series_provider_id(value: &Value, provider: &str) -> Option<String> {
    child(value, "Series")
        .and_then(|s| child(s, "ProviderIds"))
        .and_then(Value::as_object)
        .and_then(|m| get_ci(m, provider))
        .and_then(as_string)
}

/// Extract the media lot from a nested payload, if it is a movie or episode.
fn nested_lot(value: &Value) -> Option<MediaLot> {
    let item_type = child(value, "Item")
        .and_then(|i| child(i, "Type"))
        .and_then(as_string)?;
    if item_type == "Movie" {
        Some(MediaLot::Movie)
    } else if item_type == "Episode" {
        Some(MediaLot::Show)
    } else {
        None
    }
}

/// Trim a candidate id, treating blank strings as missing.
fn non_empty_id(id: Option<&str>) -> Option<String> {
    id.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// Handle a Jellyfin webhook payload from the unofficial webhooks plugin.
///
/// The unofficial integration is preserved byte-for-byte. Official-plugin flat
/// payloads carrying `NotificationType` are delegated to `jellyfin_official`
/// without any config change. `MarkPlayed`, `MarkUnplayed` and
/// `UserData.Played` completions record 100% progress without requiring ticks.
pub async fn sink_progress(
    payload: String,
    jellyfin_sink_username: Option<String>,
    jellyfin_sink_metadata_provider: Option<String>,
) -> Result<Option<ImportResult>> {
    if let Ok(value) = serde_json::from_str::<Value>(&payload) {
        if has_notification_type(&value) {
            return jellyfin_official::sink_progress_official(
                payload,
                jellyfin_sink_username,
                jellyfin_sink_metadata_provider,
            )
            .await;
        }
        let event = event_name(&value);
        let played = played_flag(&value);
        let is_mark_played = event.as_deref().is_some_and(|e| e.eq_ignore_ascii_case("MarkPlayed"));
        let is_mark_unplayed =
            event.as_deref().is_some_and(|e| e.eq_ignore_ascii_case("MarkUnplayed"));
        if is_mark_unplayed {
            return Ok(None);
        }
        if is_mark_played || played {
            let user = nested_username(&value);
            if let Some(expected) = jellyfin_sink_username.as_deref()
                && user.as_deref() != Some(expected)
            {
                return Ok(None);
            }
            let use_tvdb = jellyfin_sink_metadata_provider.as_deref() == Some("tvdb");
            let (identifier, source) = match use_tvdb {
                true => {
                    let id = non_empty_id(series_provider_id(&value, "tvdb").as_deref())
                        .or_else(|| non_empty_id(item_provider_id(&value, "tvdb").as_deref()))
                        .ok_or_else(|| anyhow!("No TVDB ID associated with this media"))?;
                    (id, MediaSource::Tvdb)
                }
                false => {
                    let id = non_empty_id(item_provider_id(&value, "tmdb").as_deref())
                        .or_else(|| non_empty_id(series_provider_id(&value, "tmdb").as_deref()))
                        .ok_or_else(|| anyhow!("No TMDb ID associated with this media"))?;
                    (id, MediaSource::Tmdb)
                }
            };
            let lot = match nested_lot(&value) {
                Some(l) => l,
                None => return Ok(None),
            };
            let (season, episode) = {
                let season = child(&value, "Item")
                    .and_then(|i| child(i, "ParentIndexNumber"))
                    .and_then(|v| match v {
                        Value::Number(n) => n.as_i64().and_then(|v| i32::try_from(v).ok()),
                        Value::String(s) => s.trim().parse::<i32>().ok(),
                        _ => None,
                    });
                let episode = child(&value, "Item")
                    .and_then(|i| child(i, "IndexNumber"))
                    .and_then(|v| match v {
                        Value::Number(n) => n.as_i64().and_then(|v| i32::try_from(v).ok()),
                        Value::String(s) => s.trim().parse::<i32>().ok(),
                        _ => None,
                    });
                (season, episode)
            };
            return Ok(Some(jellyfin_official::build_import_result(
                lot,
                source,
                identifier,
                season,
                episode,
                dec!(100),
            )));
        }
    }
    let payload = serde_json::from_str::<models::JellyfinWebhookPayload>(&payload)?;
    if let Some(jellyfin_sink_username) = jellyfin_sink_username
        && payload.user.as_ref().and_then(|u| u.name.as_ref()) != Some(&jellyfin_sink_username)
    {
        return Ok(None);
    }
    let use_tvdb = jellyfin_sink_metadata_provider.as_deref() == Some("tvdb");
    let (identifier, source) = match use_tvdb {
        true => {
            let id = payload
                .series
                .as_ref()
                .and_then(|s| s.provider_ids.tvdb.as_ref())
                .or(payload.item.provider_ids.tvdb.as_ref())
                .ok_or_else(|| anyhow!("No TVDB ID associated with this media"))?
                .clone();
            (id, MediaSource::Tvdb)
        }
        false => {
            let id = payload
                .item
                .provider_ids
                .tmdb
                .as_ref()
                .or_else(|| {
                    payload
                        .series
                        .as_ref()
                        .and_then(|s| s.provider_ids.tmdb.as_ref())
                })
                .ok_or_else(|| anyhow!("No TMDb ID associated with this media"))?
                .clone();
            (id, MediaSource::Tmdb)
        }
    };

    let lot = match payload.item.item_type.as_str() {
        "Movie" => MediaLot::Movie,
        "Episode" => MediaLot::Show,
        _ => return Ok(None),
    };

    let mut seen_item = ImportOrExportMetadataItemSeen {
        show_season_number: payload.item.season_number,
        show_episode_number: payload.item.episode_number,
        providers_consumed_on: Some(vec!["Jellyfin".to_string()]),
        ..Default::default()
    };

    let runtime = payload
        .item
        .run_time_ticks
        .ok_or_else(|| anyhow!("No run time associated with this media"))?;

    let position = payload
        .session
        .as_ref()
        .and_then(|s| s.play_state.position_ticks.as_ref())
        .ok_or_else(|| anyhow!("No position associated with this media"))?;

    seen_item.progress = Some(position / runtime * dec!(100));

    let result = ImportResult {
        completed: vec![ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
            lot,
            source,
            identifier,
            seen_history: vec![seen_item],
            ..Default::default()
        })],
        ..Default::default()
    };

    Ok(Some(result))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Extract the progress of the first seen item, if any.
    fn seen_progress(result: &Option<ImportResult>) -> Option<Decimal> {
        result.as_ref()?.completed.first().and_then(|c| match c {
            ImportCompletedItem::Metadata(m) => m.seen_history.first().and_then(|s| s.progress),
            _ => None,
        })
    }

    /// Extract the identifier and season or episode numbers of the first item.
    fn first_details(result: &Option<ImportResult>) -> Option<(String, Option<i32>, Option<i32>)> {
        result.as_ref()?.completed.first().and_then(|c| match c {
            ImportCompletedItem::Metadata(m) => {
                let seen = m.seen_history.first()?;
                Some((
                    m.identifier.clone(),
                    seen.show_season_number,
                    seen.show_episode_number,
                ))
            }
            _ => None,
        })
    }

    /// Run the unofficial sink, blocking on its async entrypoint for tests.
    fn run_sink(payload: serde_json::Value, user: Option<&str>, provider: Option<&str>) -> Result<Option<ImportResult>> {
        futures::executor::block_on(sink_progress(
            payload.to_string(),
            user.map(str::to_owned),
            provider.map(str::to_owned),
        ))
    }

    #[test]
    fn unofficial_movie_play_computes_progress() {
        let payload = json!({
            "Event": "Play",
            "Item": {"Type": "Movie", "RunTimeTicks": 1000, "ProviderIds": {"Tmdb": "123"}},
            "Session": {"PlayState": {"PositionTicks": 250}}
        });
        let result = run_sink(payload, None, None).unwrap();
        assert_eq!(seen_progress(&result), Some(dec!(25)));
        assert_eq!(first_details(&result).unwrap().0, "123");
    }

    #[test]
    fn unofficial_episode_uses_series_tmdb_fallback() {
        let payload = json!({
            "Event": "Progress",
            "Item": {"Type": "Episode", "ParentIndexNumber": 2, "IndexNumber": 3,
                     "RunTimeTicks": 2000, "ProviderIds": {}},
            "Series": {"Type": "Series", "ProviderIds": {"Tmdb": "456"}},
            "Session": {"PlayState": {"PositionTicks": 1000}}
        });
        let result = run_sink(payload, None, None).unwrap();
        assert_eq!(seen_progress(&result), Some(dec!(50)));
        assert_eq!(
            first_details(&result).unwrap(),
            ("456".to_owned(), Some(2), Some(3))
        );
    }

    #[test]
    fn mismatched_username_is_ignored() {
        let payload = json!({
            "Event": "Play",
            "User": {"Name": "bob"},
            "Item": {"Type": "Movie", "RunTimeTicks": 1000, "ProviderIds": {"Tmdb": "123"}},
            "Session": {"PlayState": {"PositionTicks": 250}}
        });
        let result = run_sink(payload, Some("alice"), None).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn missing_ids_returns_error() {
        let payload = json!({
            "Event": "Play",
            "Item": {"Type": "Movie", "RunTimeTicks": 1000, "ProviderIds": {}},
            "Session": {"PlayState": {"PositionTicks": 250}}
        });
        assert!(run_sink(payload, None, None).is_err());
    }

    #[test]
    fn non_movie_episode_is_ignored() {
        let payload = json!({
            "Event": "Play",
            "Item": {"Type": "Series", "RunTimeTicks": 1000, "ProviderIds": {"Tmdb": "123"}},
            "Session": {"PlayState": {"PositionTicks": 250}}
        });
        let result = run_sink(payload, None, None).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn normalized_template_stop_with_played_is_full_progress() {
        let payload = json!({
            "Event": "Stop",
            "User": {"Name": "alice"},
            "Item": {"Type": "Episode", "SeriesName": "Friends", "ParentIndexNumber": 1,
                     "IndexNumber": 1, "ProviderIds": {"Tmdb": "", "Imdb": "tt0583459", "Tvdb": "303821"},
                     "UserData": {"Played": true}}
        });
        let result = run_sink(payload, Some("alice"), Some("tvdb")).unwrap();
        assert_eq!(seen_progress(&result), Some(dec!(100)));
        assert_eq!(first_details(&result).unwrap().0, "303821");
    }

    #[test]
    fn normalized_template_play_with_ticks_computes_progress() {
        let payload = json!({
            "Event": "Play",
            "Item": {"Type": "Movie", "RunTimeTicks": 4000,
                     "ProviderIds": {"Tmdb": "555"}, "UserData": {"Played": false}},
            "Session": {"PlayState": {"PositionTicks": 1000}}
        });
        let result = run_sink(payload, None, None).unwrap();
        assert_eq!(seen_progress(&result), Some(dec!(25)));
    }

    #[test]
    fn mark_played_completes_and_mark_unplayed_is_ignored() {
        let played = json!({
            "Event": "MarkPlayed",
            "Item": {"Type": "Movie", "ProviderIds": {"Tmdb": "606"}}
        });
        let result = run_sink(played, None, None).unwrap();
        assert_eq!(seen_progress(&result), Some(dec!(100)));
        let unplayed = json!({
            "Event": "MarkUnplayed",
            "Item": {"Type": "Movie", "ProviderIds": {"Tmdb": "606"}}
        });
        let result = run_sink(unplayed, None, None).unwrap();
        assert!(result.is_none());
    }
}
