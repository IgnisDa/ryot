//! Official Jellyfin webhook sink, additive to the unofficial integration.
//!
//! Handles the official `jellyfin-plugin-webhook` flat dictionary keyed by
//! `NotificationType`. The unofficial path in `super::jellyfin` is untouched.

use anyhow::{Result, anyhow, bail};
use dependent_models::{ImportCompletedItem, ImportOrExportMetadataItem, ImportResult};
use enum_models::{MediaLot, MediaSource};
use media_models::ImportOrExportMetadataItemSeen;
use rust_decimal::{Decimal, dec};
use serde_json::{Map, Value};

/// Events producing progress for official-plugin flat payloads.
pub const OFFICIAL_PROGRESS_EVENTS: &[&str] = &["PlaybackStart", "PlaybackStop", "PlaybackProgress"];
/// Event marking media watched; Ryot sinks have no delete semantics otherwise.
pub const MARK_PLAYED_EVENT: &str = "MarkPlayed";
/// Event marking media unwatched, which is ignored since deletes are unsupported.
pub const MARK_UNPLAYED_EVENT: &str = "MarkUnplayed";

/// Check a configured username against the username carried by a webhook payload.
pub fn is_username_allowed(
    configured_username: Option<&str>,
    payload_username: Option<&str>,
) -> bool {
    match configured_username.map(str::trim) {
        None => true,
        Some(expected) => payload_username.map(str::trim) == Some(expected),
    }
}

/// Trim a candidate id, treating blank strings as missing.
fn non_empty_id(id: Option<&str>) -> Option<String> {
    id.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

/// Pick the external identifier honoring the configured metadata provider.
pub fn resolve_identifier(
    tmdb_id: Option<&str>,
    tvdb_id: Option<&str>,
    imdb_id: Option<&str>,
    metadata_provider: Option<&str>,
) -> Result<(String, MediaSource)> {
    let use_tvdb = metadata_provider.is_some_and(|p| p.trim().eq_ignore_ascii_case("tvdb"));
    if use_tvdb {
        if let Some(id) = non_empty_id(tvdb_id) {
            return Ok((id, MediaSource::Tvdb));
        }
    } else if let Some(id) = non_empty_id(tmdb_id) {
        return Ok((id, MediaSource::Tmdb));
    }
    if let Some(imdb) = non_empty_id(imdb_id) {
        bail!("Found only an IMDb ID ({imdb}), but only TMDb and TVDB identifiers are supported");
    }
    if use_tvdb {
        bail!("No TVDB ID associated with this media")
    } else {
        bail!("No TMDb ID associated with this media")
    }
}

/// Calculate a progress percentage from Jellyfin ticks (100ns units, 10M per second).
pub fn progress_from_ticks(position: Decimal, runtime: Decimal) -> Result<Decimal> {
    if runtime.is_zero() {
        bail!("Run time is zero, cannot compute progress");
    }
    Ok(position / runtime * dec!(100))
}

/// Assemble the import result recorded for a Jellyfin playback event.
pub fn build_import_result(
    lot: MediaLot,
    source: MediaSource,
    identifier: String,
    season_number: Option<i32>,
    episode_number: Option<i32>,
    progress: Decimal,
) -> ImportResult {
    ImportResult {
        completed: vec![ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
            lot,
            source,
            identifier,
            seen_history: vec![ImportOrExportMetadataItemSeen {
                progress: Some(progress),
                show_season_number: season_number,
                show_episode_number: episode_number,
                providers_consumed_on: Some(vec!["Jellyfin".to_string()]),
                ..Default::default()
            }],
            ..Default::default()
        })],
        ..Default::default()
    }
}

/// Playback information extracted from an official-plugin flat payload.
#[derive(Debug, Clone)]
pub struct OfficialPlayback {
    pub item_type: String,
    pub event_name: String,
    pub tmdb_id: Option<String>,
    pub tvdb_id: Option<String>,
    pub imdb_id: Option<String>,
    pub username: Option<String>,
    pub played_to_completion: bool,
    pub season_number: Option<i32>,
    pub episode_number: Option<i32>,
    pub runtime_ticks: Option<Decimal>,
    pub position_ticks: Option<Decimal>,
}

/// Look up a key in a JSON object without regard to letter case.
fn get_ci<'a>(map: &'a Map<String, Value>, key: &str) -> Option<&'a Value> {
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

/// Coerce a JSON value into a decimal, accepting numbers and numeric strings.
fn as_decimal(value: &Value) -> Option<Decimal> {
    match value {
        Value::Number(n) => n.to_string().parse::<Decimal>().ok(),
        Value::String(s) => s.trim().parse::<Decimal>().ok(),
        _ => None,
    }
}

/// Coerce a JSON value into an integer, accepting numbers and numeric strings.
fn as_i32(value: &Value) -> Option<i32> {
    match value {
        Value::Number(n) => n.as_i64().and_then(|v| i32::try_from(v).ok()),
        Value::String(s) => s.trim().parse::<i32>().ok(),
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

/// Find the first present flat key from a list of case-insensitive aliases.
fn first_flat<'a>(map: &'a Map<String, Value>, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().find_map(|k| get_ci(map, k))
}

/// Extract a string field, checking flat keys first and the nested item after.
fn string_field(root: &Value, flat_keys: &[&str], item_keys: &[&str]) -> Option<String> {
    root.as_object()
        .and_then(|m| first_flat(m, flat_keys))
        .and_then(as_string)
        .or_else(|| {
            child(root, "Item")
                .and_then(|i| i.as_object())
                .and_then(|m| first_flat(m, item_keys))
                .and_then(as_string)
        })
}

/// Extract an integer field, checking flat keys first and the nested item after.
fn integer_field(root: &Value, flat_keys: &[&str], item_keys: &[&str]) -> Option<i32> {
    root.as_object()
        .and_then(|m| first_flat(m, flat_keys))
        .and_then(as_i32)
        .or_else(|| {
            child(root, "Item")
                .and_then(|i| i.as_object())
                .and_then(|m| first_flat(m, item_keys))
                .and_then(as_i32)
        })
}

/// Extract a decimal field, checking flat keys first and the nested item after.
fn decimal_field(root: &Value, flat_keys: &[&str], item_keys: &[&str]) -> Option<Decimal> {
    root.as_object()
        .and_then(|m| first_flat(m, flat_keys))
        .and_then(as_decimal)
        .or_else(|| {
            child(root, "Item")
                .and_then(|i| i.as_object())
                .and_then(|m| first_flat(m, item_keys))
                .and_then(as_decimal)
        })
}

/// Extract a bool field, checking flat keys first and the nested item after.
fn bool_field(root: &Value, flat_keys: &[&str], item_keys: &[&str]) -> Option<bool> {
    root.as_object()
        .and_then(|m| first_flat(m, flat_keys))
        .and_then(as_bool)
        .or_else(|| {
            child(root, "Item")
                .and_then(|i| i.as_object())
                .and_then(|m| first_flat(m, item_keys))
                .and_then(as_bool)
        })
}

/// Extract a provider id from flat keys, falling back to nested item objects.
fn provider_id(root: &Value, provider: &str) -> Option<String> {
    let prefixed = format!("Provider_{provider}");
    let flat = root
        .as_object()
        .and_then(|m| first_flat(m, &[&prefixed, provider]))
        .and_then(as_string);
    if flat.is_some() {
        return flat;
    }
    ["Item", "Series"].iter().find_map(|section| {
        child(root, section)
            .and_then(|i| child(i, "ProviderIds"))
            .and_then(Value::as_object)
            .and_then(|m| first_flat(m, &[provider]))
            .and_then(as_string)
    })
}

/// Parse an official-plugin flat payload into normalized playback information.
pub fn parse_official_payload(value: &Value) -> Result<OfficialPlayback> {
    let root = value
        .as_object()
        .ok_or_else(|| anyhow!("Official Jellyfin payload must be a JSON object"))?;
    let event_name = first_flat(root, &["NotificationType"])
        .and_then(as_string)
        .ok_or_else(|| anyhow!("Official Jellyfin payload is missing NotificationType"))?;
    let item_type = string_field(value, &["ItemType"], &["Type"])
        .ok_or_else(|| anyhow!("Official Jellyfin payload is missing ItemType"))?;
    let position_ticks = decimal_field(value, &["PlaybackPositionTicks", "PositionTicks"], &[
        "PositionTicks",
    ])
    .or_else(|| {
        child(value, "Session")
            .and_then(|s| child(s, "PlayState"))
            .and_then(|p| child(p, "PositionTicks"))
            .and_then(as_decimal)
    });
    let runtime_ticks = decimal_field(value, &["RunTimeTicks", "RuntimeTicks"], &["RunTimeTicks"]);
    let played_to_completion =
        bool_field(value, &["PlayedToCompletion", "Played"], &["Played"]).unwrap_or(false);
    let username = string_field(value, &["NotificationUsername", "Username"], &["Name"]).or_else(|| {
        child(value, "User")
            .and_then(|u| u.as_object())
            .and_then(|m| first_flat(m, &["Name"]))
            .and_then(as_string)
    });
    let played_flag = child(value, "Item")
        .and_then(|i| child(i, "UserData"))
        .and_then(|u| child(u, "Played"))
        .and_then(as_bool)
        .unwrap_or(false);
    Ok(OfficialPlayback {
        username,
        item_type,
        event_name,
        runtime_ticks,
        position_ticks,
        tmdb_id: provider_id(value, "tmdb"),
        tvdb_id: provider_id(value, "tvdb"),
        imdb_id: provider_id(value, "imdb"),
        played_to_completion: played_to_completion || played_flag,
        episode_number: integer_field(
            value,
            &[
                "EpisodeNumber",
                "EpisodeNumber00",
                "EpisodeNumber000",
                "IndexNumber",
            ],
            &["IndexNumber", "EpisodeNumber"],
        ),
        season_number: integer_field(
            value,
            &[
                "SeasonNumber",
                "SeasonNumber00",
                "SeasonNumber000",
                "ParentIndexNumber",
            ],
            &["ParentIndexNumber", "SeasonNumber"],
        ),
    })
}

/// Resolve parsed official-plugin information into an import result.
pub fn resolve(
    info: OfficialPlayback,
    username: Option<&str>,
    metadata_provider: Option<&str>,
) -> Result<Option<ImportResult>> {
    if info.event_name.eq_ignore_ascii_case(MARK_UNPLAYED_EVENT) {
        return Ok(None);
    }
    let completed =
        info.event_name.eq_ignore_ascii_case(MARK_PLAYED_EVENT) || info.played_to_completion;
    let supported = OFFICIAL_PROGRESS_EVENTS
        .iter()
        .any(|e| info.event_name.eq_ignore_ascii_case(e));
    if !completed && !supported {
        return Ok(None);
    }
    if !is_username_allowed(username, info.username.as_deref()) {
        return Ok(None);
    }
    let lot = if info.item_type.eq_ignore_ascii_case("Movie") {
        MediaLot::Movie
    } else if info.item_type.eq_ignore_ascii_case("Episode") {
        MediaLot::Show
    } else {
        return Ok(None);
    };
    let (identifier, source) = resolve_identifier(
        info.tmdb_id.as_deref(),
        info.tvdb_id.as_deref(),
        info.imdb_id.as_deref(),
        metadata_provider,
    )?;
    let progress = if completed {
        dec!(100)
    } else {
        match (info.position_ticks, info.runtime_ticks) {
            (Some(position), Some(runtime)) => progress_from_ticks(position, runtime)?,
            _ => bail!(
                "Official Jellyfin payload has no playback ticks despite PlayedToCompletion being false"
            ),
        }
    };
    Ok(Some(build_import_result(
        lot,
        source,
        identifier,
        info.season_number,
        info.episode_number,
        progress,
    )))
}

/// Handle an official-plugin flat payload from the Jellyfin webhook plugin.
pub async fn sink_progress_official(
    payload: String,
    username: Option<String>,
    provider: Option<String>,
) -> Result<Option<ImportResult>> {
    let value: Value = serde_json::from_str(&payload)?;
    let info = parse_official_payload(&value)?;
    resolve(info, username.as_deref(), provider.as_deref())
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

    fn run_official(payload: Value, user: Option<&str>, provider: Option<&str>) -> Result<Option<ImportResult>> {
        let info = parse_official_payload(&payload)?;
        resolve(info, user, provider)
    }

    #[test]
    fn official_movie_stop_completed_is_full_progress() {
        let payload = json!({
            "NotificationType": "PlaybackStop",
            "ItemType": "Movie",
            "Provider_tmdb": "789",
            "PlayedToCompletion": true
        });
        let result = run_official(payload, None, None).unwrap();
        assert_eq!(seen_progress(&result), Some(dec!(100)));
    }

    #[test]
    fn official_episode_start_with_numbers_computes_progress() {
        let payload = json!({
            "NotificationType": "PlaybackStart",
            "ItemType": "Episode",
            "Provider_tmdb": "101",
            "SeasonNumber": 1,
            "EpisodeNumber": 2,
            "PlaybackPositionTicks": 500,
            "RunTimeTicks": 2000,
            "PlayedToCompletion": false
        });
        let result = run_official(payload, None, None).unwrap();
        assert_eq!(seen_progress(&result), Some(dec!(25)));
        assert_eq!(
            first_details(&result).unwrap(),
            ("101".to_owned(), Some(1), Some(2))
        );
    }

    #[test]
    fn official_string_coerced_values_parse() {
        let payload = json!({
            "NotificationType": "PlaybackProgress",
            "ItemType": "Episode",
            "Provider_TMDB": "202",
            "SeasonNumber00": "01",
            "EpisodeNumber00": "02",
            "PlaybackPositionTicks": "500",
            "RunTimeTicks": "2000",
            "PlayedToCompletion": "False"
        });
        let result = run_official(payload, None, None).unwrap();
        assert_eq!(seen_progress(&result), Some(dec!(25)));
        assert_eq!(
            first_details(&result).unwrap(),
            ("202".to_owned(), Some(1), Some(2))
        );
        let completed = json!({
            "NotificationType": "PlaybackStop",
            "ItemType": "Movie",
            "Provider_tmdb": "202",
            "PlayedToCompletion": "True"
        });
        let result = run_official(completed, None, None).unwrap();
        assert_eq!(seen_progress(&result), Some(dec!(100)));
    }

    #[test]
    fn official_completed_without_ticks_is_full_progress() {
        let payload = json!({
            "NotificationType": "PlaybackStop",
            "ItemType": "Movie",
            "Provider_tmdb": "303",
            "PlayedToCompletion": true
        });
        let result = run_official(payload, None, None).unwrap();
        assert_eq!(seen_progress(&result), Some(dec!(100)));
    }

    #[test]
    fn unsupported_notification_types_are_ignored() {
        for notification in ["ItemAdded", "SessionStart", "AuthenticationSuccess"] {
            let payload = json!({
                "NotificationType": notification,
                "ItemType": "Movie",
                "Provider_tmdb": "404",
                "PlaybackPositionTicks": 10,
                "RunTimeTicks": 100
            });
            let result = run_official(payload, None, None).unwrap();
            assert!(result.is_none(), "expected {notification} to be ignored");
        }
    }
}
