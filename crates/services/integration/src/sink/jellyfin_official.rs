use std::sync::Arc;

use anyhow::{Context, Result, bail};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, EpisodeExternalIdsCacheInput, ImportCompletedItem,
    ImportOrExportMetadataItem, ImportResult,
};
use dependent_provider_utils::{get_tmdb_non_media_service, get_tvdb_non_media_service};
use enum_models::{MediaLot, MediaSource};
use media_models::ImportOrExportMetadataItemSeen;
use rust_decimal::{Decimal, dec};
use serde_json::Value;

pub use super::jellyfin_parser::parse_official_payload;
use supporting_service::SupportingService;

/// Events producing progress for official-plugin flat payloads.
pub const OFFICIAL_PROGRESS_EVENTS: &[&str] =
    &["PlaybackStart", "PlaybackStop", "PlaybackProgress"];
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

/// The IMDb and TVDB ids that the show of an episode without a TMDb id is looked up by.
fn episode_external_ids_cache_input(info: &OfficialPlayback) -> EpisodeExternalIdsCacheInput {
    EpisodeExternalIdsCacheInput {
        imdb_id: info.episode_imdb_id.clone(),
        tvdb_id: info.episode_tvdb_id.clone(),
    }
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
        EpisodeShowLookup::TmdbExternalIds => {
            // Only shows that were found are cached, so episodes that TMDb does not know yet
            // are looked up again on the next event.
            let key = ApplicationCacheKey::TmdbEpisodeShowIdByExternalIds(
                episode_external_ids_cache_input(info),
            );
            if let Some((_, show_id)) = cache_service::get_value::<String>(ss, key.clone()).await {
                return Ok(Some(show_id));
            }
            let show_id = find_show_on_tmdb(None, info, ss).await?;
            if let Some(show_id) = &show_id {
                cache_service::set_key(
                    ss,
                    key,
                    ApplicationCacheValue::TmdbEpisodeShowIdByExternalIds(show_id.clone()),
                )
                .await?;
            }
            return Ok(show_id);
        }
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
#[path = "jellyfin_tests.rs"]
mod tests;
