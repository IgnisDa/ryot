use anyhow::{Result, anyhow};
use rust_decimal::Decimal;
use serde_json::{Map, Value};

use super::jellyfin_official::OfficialPlayback;

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

/// Extract a provider id from the `ProviderIds` object of a nested section.
fn nested_provider_id(root: &Value, section: &str, provider: &str) -> Option<String> {
    child(root, section)
        .and_then(|s| child(s, "ProviderIds"))
        .and_then(Value::as_object)
        .and_then(|m| first_flat(m, &[provider]))
        .and_then(as_string)
}

/// Extract a provider id of the item itself.
fn item_provider_id(root: &Value, provider: &str) -> Option<String> {
    let prefixed = format!("Provider_{provider}");
    root.as_object()
        .and_then(|m| first_flat(m, &[&prefixed, provider]))
        .and_then(as_string)
        .or_else(|| nested_provider_id(root, "Item", provider))
}

/// Extract a provider id of the series of an episode.
///
/// The official plugin only sends the provider ids of the episode itself as
/// `Provider_<key>`, so these are never used as the ids of its series.
fn series_provider_id(root: &Value, provider: &str) -> Option<String> {
    let prefixed = format!("SeriesProvider_{provider}");
    root.as_object()
        .and_then(|m| first_flat(m, &[&prefixed]))
        .and_then(as_string)
        .or_else(|| nested_provider_id(root, "Series", provider))
}

/// Parse an official-plugin flat payload into normalized playback information.
pub fn parse_official_payload(value: &Value) -> Result<OfficialPlayback> {
    let root = value
        .as_object()
        .ok_or_else(|| anyhow!("Jellyfin payload must be a JSON object"))?;
    let event_name = first_flat(root, &["NotificationType", "Event"])
        .and_then(as_string)
        .ok_or_else(|| anyhow!("Jellyfin payload is missing NotificationType or Event"))?;
    let event_name = match event_name.to_ascii_lowercase().as_str() {
        "play" => "PlaybackStart".to_owned(),
        "stop" => "PlaybackStop".to_owned(),
        "progress" | "pause" | "resume" => "PlaybackProgress".to_owned(),
        _ => event_name,
    };
    let item_type = string_field(value, &["ItemType"], &["Type"])
        .ok_or_else(|| anyhow!("Jellyfin payload is missing ItemType"))?;
    let position_ticks = decimal_field(
        value,
        &["PlaybackPositionTicks", "PositionTicks"],
        &["PositionTicks"],
    )
    .or_else(|| {
        child(value, "Session")
            .and_then(|s| child(s, "PlayState"))
            .and_then(|p| child(p, "PositionTicks"))
            .and_then(as_decimal)
    });
    let runtime_ticks = decimal_field(value, &["RunTimeTicks", "RuntimeTicks"], &["RunTimeTicks"]);
    let played_to_completion =
        bool_field(value, &["PlayedToCompletion", "Played"], &["Played"]).unwrap_or(false);
    let username = string_field(value, &["NotificationUsername", "Username"], &[]).or_else(|| {
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
    let is_episode = item_type.eq_ignore_ascii_case("Episode");
    let media_id = |provider| match is_episode {
        true => series_provider_id(value, provider),
        false => item_provider_id(value, provider),
    };
    let episode_id = |provider| {
        is_episode
            .then(|| item_provider_id(value, provider))
            .flatten()
    };
    Ok(OfficialPlayback {
        username,
        item_type,
        event_name,
        runtime_ticks,
        position_ticks,
        tmdb_id: media_id("tmdb"),
        tvdb_id: media_id("tvdb"),
        imdb_id: media_id("imdb"),
        episode_tmdb_id: episode_id("tmdb"),
        episode_tvdb_id: episode_id("tvdb"),
        episode_imdb_id: episode_id("imdb"),
        series_name: is_episode
            .then(|| {
                string_field(value, &["SeriesName"], &["SeriesName"]).or_else(|| {
                    child(value, "Series")
                        .and_then(|s| child(s, "Name"))
                        .and_then(as_string)
                })
            })
            .flatten(),
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
