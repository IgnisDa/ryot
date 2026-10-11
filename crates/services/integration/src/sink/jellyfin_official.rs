//! Official Jellyfin webhook sink, additive to the unofficial integration.
//!
//! Handles the official `jellyfin-plugin-webhook` flat dictionary keyed by
//! `NotificationType`. The unofficial path in `super::jellyfin` is untouched.

use std::sync::Arc;

use anyhow::{Context, Result, anyhow, bail};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, ImportCompletedItem, ImportOrExportMetadataItem,
    ImportResult,
};
use dependent_provider_utils::{get_tmdb_non_media_service, get_tvdb_non_media_service};
use enum_models::{MediaLot, MediaSource};
use media_models::ImportOrExportMetadataItemSeen;
use rust_decimal::{Decimal, dec};
use serde_json::{Map, Value};
use supporting_service::SupportingService;

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

/// Check whether the configured metadata provider is TVDB rather than TMDb.
fn uses_tvdb(metadata_provider: Option<&str>) -> bool {
    metadata_provider.is_some_and(|p| p.trim().eq_ignore_ascii_case("tvdb"))
}

/// Pick the external identifier honoring the configured metadata provider.
pub fn resolve_identifier(
    tmdb_id: Option<&str>,
    tvdb_id: Option<&str>,
    imdb_id: Option<&str>,
    metadata_provider: Option<&str>,
) -> Result<(String, MediaSource)> {
    let use_tvdb = uses_tvdb(metadata_provider);
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
///
/// For episodes, `tmdb_id`, `tvdb_id` and `imdb_id` are the ids of the show, while the
/// `episode_*` ids are those of the episode itself.
#[derive(Debug, Clone)]
pub struct OfficialPlayback {
    pub item_type: String,
    pub event_name: String,
    pub tmdb_id: Option<String>,
    pub tvdb_id: Option<String>,
    pub imdb_id: Option<String>,
    pub episode_tmdb_id: Option<String>,
    pub episode_tvdb_id: Option<String>,
    pub episode_imdb_id: Option<String>,
    pub series_name: Option<String>,
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
            .then(|| string_field(value, &["SeriesName"], &["SeriesName"]))
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

/// Check whether parsed official-plugin information should produce an import.
fn is_importable(info: &OfficialPlayback, username: Option<&str>) -> bool {
    if info.event_name.eq_ignore_ascii_case(MARK_UNPLAYED_EVENT) {
        return false;
    }
    let is_mark_played = info.event_name.eq_ignore_ascii_case(MARK_PLAYED_EVENT);
    let supported = OFFICIAL_PROGRESS_EVENTS
        .iter()
        .any(|e| info.event_name.eq_ignore_ascii_case(e));
    (supported || is_mark_played) && is_username_allowed(username, info.username.as_deref())
}

/// Resolve parsed official-plugin information into an import result.
pub fn resolve(
    info: OfficialPlayback,
    username: Option<&str>,
    metadata_provider: Option<&str>,
) -> Result<Option<ImportResult>> {
    if !is_importable(&info, username) {
        return Ok(None);
    }
    let is_mark_played = info.event_name.eq_ignore_ascii_case(MARK_PLAYED_EVENT);
    let completed = is_mark_played || info.played_to_completion;
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

/// How to look up the show of an episode whose payload does not carry an id of the show
/// for the configured metadata provider.
#[derive(Debug, PartialEq)]
enum EpisodeShowLookup {
    /// By the TVDB id of the episode.
    TvdbEpisode(String),
    /// By the TMDb id of the episode, trying its IMDb and TVDB ids first.
    TmdbEpisode(String),
    /// By the IMDb or TVDB id of the episode, which has no TMDb id.
    TmdbExternalIds,
}

/// Pick how to look up the show of an episode, when the payload does not carry an id of
/// the show for the configured metadata provider.
fn episode_show_lookup(
    info: &OfficialPlayback,
    metadata_provider: Option<&str>,
) -> Option<EpisodeShowLookup> {
    if !info.item_type.eq_ignore_ascii_case("Episode") {
        return None;
    }
    if uses_tvdb(metadata_provider) {
        return match info.tvdb_id {
            Some(_) => None,
            None => info
                .episode_tvdb_id
                .clone()
                .map(EpisodeShowLookup::TvdbEpisode),
        };
    }
    if info.tmdb_id.is_some() {
        return None;
    }
    match &info.episode_tmdb_id {
        Some(id) => Some(EpisodeShowLookup::TmdbEpisode(id.clone())),
        None => (info.episode_imdb_id.is_some() || info.episode_tvdb_id.is_some())
            .then_some(EpisodeShowLookup::TmdbExternalIds),
    }
}

// The official plugin only sends the IDs of an episode, so its show is looked up on TMDb
// through the IMDb or TVDB ID of the episode, or else by title and the TMDb ID of the episode.
async fn find_show_on_tmdb(
    episode_id: Option<&str>,
    info: &OfficialPlayback,
    ss: &Arc<SupportingService>,
) -> Result<Option<String>> {
    let tmdb_service = get_tmdb_non_media_service(ss).await?;
    let external_ids = [
        (info.episode_imdb_id.as_deref(), "imdb_id"),
        (info.episode_tvdb_id.as_deref(), "tvdb_id"),
    ];
    for (external_id, external_source) in external_ids
        .into_iter()
        .filter_map(|(id, source)| id.map(|id| (id, source)))
    {
        let show_id = tmdb_service
            .find_show_by_episode_external_id(external_id, external_source)
            .await
            .with_context(|| format!("Could not look up episode {external_id} on TMDb"))?;
        if show_id.is_some() {
            return Ok(show_id);
        }
    }
    let (Some(episode_id), Some(series_name), Some(season_number)) =
        (episode_id, &info.series_name, info.season_number)
    else {
        return Ok(None);
    };
    tmdb_service
        .find_show_by_episode_title(series_name, season_number, episode_id)
        .await
        .with_context(|| format!("Could not look up show {series_name:?} on TMDb"))
}

/// Find the show of an episode on the configured metadata provider.
async fn find_episode_show_id(
    lookup: &EpisodeShowLookup,
    info: &OfficialPlayback,
    ss: &Arc<SupportingService>,
) -> Result<Option<String>> {
    let show_id = match lookup {
        EpisodeShowLookup::TvdbEpisode(episode_id) => {
            cache_service::get_or_set_with_callback(
                ss,
                ApplicationCacheKey::TvdbEpisodeShowId(episode_id.to_owned()),
                ApplicationCacheValue::TvdbEpisodeShowId,
                || async {
                    get_tvdb_non_media_service(ss)
                        .await?
                        .find_series_by_episode_id(episode_id)
                        .await
                        .with_context(|| format!("Could not look up episode {episode_id} on TVDB"))
                },
            )
            .await?
        }
        EpisodeShowLookup::TmdbEpisode(episode_id) => {
            cache_service::get_or_set_with_callback(
                ss,
                ApplicationCacheKey::TmdbEpisodeShowId(episode_id.to_owned()),
                ApplicationCacheValue::TmdbEpisodeShowId,
                || find_show_on_tmdb(Some(episode_id), info, ss),
            )
            .await?
        }
        // The cache is keyed by the TMDb id of the episode, which is unknown here.
        EpisodeShowLookup::TmdbExternalIds => return find_show_on_tmdb(None, info, ss).await,
    };
    Ok(show_id.response)
}

/// Handle an official-plugin flat payload from the Jellyfin webhook plugin.
pub async fn sink_progress_official(
    payload: String,
    username: Option<String>,
    provider: Option<String>,
    ss: &Arc<SupportingService>,
) -> Result<Option<ImportResult>> {
    let value: Value = serde_json::from_str(&payload)?;
    let mut info = parse_official_payload(&value)?;
    if is_importable(&info, username.as_deref())
        && let Some(lookup) = episode_show_lookup(&info, provider.as_deref())
    {
        let show_id = find_episode_show_id(&lookup, &info, ss).await?;
        match lookup {
            EpisodeShowLookup::TvdbEpisode(_) => info.tvdb_id = show_id,
            _ => info.tmdb_id = show_id,
        }
    }
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
            "Provider_tmdb": "999",
            "SeriesProvider_tmdb": "101",
            "Series": {"ProviderIds": {"Tmdb": "101"}},
            "SeasonNumber": 1,
            "EpisodeNumber": 2,
            "PlaybackPositionTicks": 500,
            "RunTimeTicks": 2000,
            "PlayedToCompletion": false
        });
        let result = run_official(payload, None, None).unwrap();
        assert_eq!(seen_progress(&result), Some(dec!(25)));
        assert_eq!(first_details(&result).unwrap(), ("101".to_owned(), Some(1), Some(2)));
    }

    #[test]
    fn official_string_coerced_values_parse() {
        let payload = json!({
            "NotificationType": "PlaybackProgress",
            "ItemType": "Episode",
            "Provider_TMDB": "999",
            "SeriesProvider_TMDB": "202",
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

    /// A playback payload as sent by the official plugin for an episode, which only carries
    /// the provider ids of the episode itself and not those of its series.
    fn plugin_episode_payload() -> Value {
        json!({
            "NotificationType": "PlaybackProgress",
            "ItemType": "Episode",
            "Name": "Messages from Earth",
            "SeriesName": "Babylon 5",
            "SeriesId": "4cf4b1e2b5a14b4f9a3b0d6f3f6c1d2e",
            "SeasonNumber": 3,
            "EpisodeNumber": 11,
            "Provider_tvdb": "19541",
            "Provider_imdb": "tt0517686",
            "Provider_tmdb": "68923",
            "PlaybackPositionTicks": 500,
            "RunTimeTicks": 2000,
            "PlayedToCompletion": false
        })
    }

    #[test]
    fn official_episode_ids_are_not_used_as_show_ids() {
        for provider in [Some("tvdb"), None] {
            let error = run_official(plugin_episode_payload(), None, provider).unwrap_err();
            assert!(
                error.to_string().starts_with("No T"),
                "expected no show id for {provider:?}, got {error}"
            );
        }
    }

    #[test]
    fn official_episode_show_is_looked_up_by_episode_id() {
        let info = parse_official_payload(&plugin_episode_payload()).unwrap();
        assert_eq!(info.series_name.as_deref(), Some("Babylon 5"));
        assert_eq!(info.episode_imdb_id.as_deref(), Some("tt0517686"));
        assert_eq!(
            episode_show_lookup(&info, Some("tvdb")),
            Some(EpisodeShowLookup::TvdbEpisode("19541".to_owned()))
        );
        assert_eq!(
            episode_show_lookup(&info, None),
            Some(EpisodeShowLookup::TmdbEpisode("68923".to_owned()))
        );
        let mut info = info;
        info.tvdb_id = Some("70726".to_owned());
        assert_eq!(episode_show_lookup(&info, Some("tvdb")), None);
        let result = resolve(info, None, Some("tvdb")).unwrap();
        assert_eq!(
            first_details(&result).unwrap(),
            ("70726".to_owned(), Some(3), Some(11))
        );
    }

    #[test]
    fn official_episode_without_tmdb_id_is_looked_up_by_external_ids() {
        let mut payload = plugin_episode_payload();
        payload.as_object_mut().unwrap().remove("Provider_tmdb");
        let info = parse_official_payload(&payload).unwrap();
        assert!(episode_show_lookup(&info, None).is_some());
        assert_eq!(
            episode_show_lookup(&info, None),
            Some(EpisodeShowLookup::TmdbExternalIds)
        );
        // TVDB lookups still need the TVDB id of the episode.
        payload.as_object_mut().unwrap().remove("Provider_tvdb");
        let info = parse_official_payload(&payload).unwrap();
        assert_eq!(episode_show_lookup(&info, Some("tvdb")), None);
        payload.as_object_mut().unwrap().remove("Provider_imdb");
        let info = parse_official_payload(&payload).unwrap();
        assert!(episode_show_lookup(&info, None).is_none());
    }

    #[test]
    fn official_show_ids_and_movies_need_no_lookup() {
        let mut payload = plugin_episode_payload();
        payload["SeriesProvider_tvdb"] = json!("70726");
        let info = parse_official_payload(&payload).unwrap();
        assert_eq!(episode_show_lookup(&info, Some("tvdb")), None);
        let movie = json!({
            "NotificationType": "PlaybackStop",
            "ItemType": "Movie",
            "Provider_tmdb": "789",
            "PlayedToCompletion": true
        });
        let info = parse_official_payload(&movie).unwrap();
        assert_eq!(info.tmdb_id.as_deref(), Some("789"));
        assert_eq!(episode_show_lookup(&info, None), None);
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
