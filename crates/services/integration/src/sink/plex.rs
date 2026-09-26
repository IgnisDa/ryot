use std::sync::Arc;

use anyhow::{Context, Result, anyhow, bail};
use common_models::StringIdObject;
use common_utils::ryot_log;
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, ImportCompletedItem, ImportOrExportMetadataItem,
    ImportResult,
};
use dependent_provider_utils::get_tmdb_non_media_service;
use enum_models::{MediaLot, MediaSource};
use media_models::ImportOrExportMetadataItemSeen;
use regex::Regex;
use rust_decimal::{Decimal, dec};
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;

mod models {
    use super::*;

    #[derive(Serialize, Deserialize, Debug, Clone)]
    pub struct PlexWebhookMetadataPayload {
        pub duration: Decimal,
        #[serde(rename = "type")]
        pub item_type: String,
        #[serde(rename = "grandparentTitle")]
        pub show_name: Option<String>,
        #[serde(rename = "parentIndex")]
        pub season_number: Option<i32>,
        #[serde(rename = "Guid")]
        pub guids: Vec<StringIdObject>,
        #[serde(rename = "index")]
        pub episode_number: Option<i32>,
        #[serde(rename = "viewOffset")]
        pub view_offset: Option<Decimal>,
    }
    #[derive(Serialize, Deserialize, Debug, Clone)]
    pub struct PlexWebhookAccount {
        #[serde(rename = "title")]
        pub plex_user: String,
    }
    #[derive(Serialize, Deserialize, Debug, Clone)]
    pub struct PlexWebhookPayload {
        pub user: bool,
        pub owner: bool,
        #[serde(rename = "event")]
        pub event_type: String,
        #[serde(rename = "Account")]
        pub account: PlexWebhookAccount,
        #[serde(rename = "Metadata")]
        pub metadata: PlexWebhookMetadataPayload,
    }
}

fn parse_payload(payload: &str) -> Result<models::PlexWebhookPayload> {
    let payload_regex = Regex::new(r"\{.*\}").unwrap();
    let json_payload = payload_regex
        .find(payload)
        .map(|x| x.as_str())
        .unwrap_or("");
    serde_json::from_str(json_payload).context("Error during JSON payload deserialization")
}

fn get_tmdb_identifier(guids: &[StringIdObject]) -> Result<&str> {
    guids
        .iter()
        .find(|g| g.id.starts_with("tmdb://"))
        .map(|g| &g.id[7..])
        .ok_or_else(|| anyhow!("No TMDb ID associated with this media"))
}

fn get_episode_external_ids(guids: &[StringIdObject]) -> Vec<(&str, &str)> {
    [("imdb://", "imdb_id"), ("tvdb://", "tvdb_id")]
        .into_iter()
        .filter_map(|(prefix, source)| {
            guids
                .iter()
                .find_map(|g| g.id.strip_prefix(prefix))
                .map(|id| (id, source))
        })
        .collect()
}

// Plex only sends the IDs of an episode, so its show is looked up on TMDb through the
// IMDb or TVDB ID of the episode, or else by title and the TMDb ID of the episode.
async fn find_show_on_tmdb(
    episode_id: &str,
    series_name: &str,
    metadata: &models::PlexWebhookMetadataPayload,
    ss: &Arc<SupportingService>,
) -> Result<Option<String>> {
    let tmdb_service = get_tmdb_non_media_service(ss).await?;
    for (external_id, external_source) in get_episode_external_ids(&metadata.guids) {
        let show_id = tmdb_service
            .find_show_by_episode_external_id(external_id, external_source)
            .await
            .with_context(|| format!("Could not look up episode {external_id} on TMDb"))?;
        if show_id.is_some() {
            return Ok(show_id);
        }
    }
    let Some(season_number) = metadata.season_number else {
        return Ok(None);
    };
    tmdb_service
        .find_show_by_episode_title(series_name, season_number, episode_id)
        .await
        .with_context(|| format!("Could not look up show {series_name:?} on TMDb"))
}

async fn get_media_info<'a>(
    identifier: &'a str,
    ss: &Arc<SupportingService>,
    metadata: &'a models::PlexWebhookMetadataPayload,
) -> Result<(String, MediaLot)> {
    match metadata.item_type.as_str() {
        "movie" => Ok((identifier.to_owned(), MediaLot::Movie)),
        "episode" => {
            let series_name = metadata.show_name.as_ref().context("Show name missing")?;
            // Plex sends several events per episode, so the lookup is cached, misses included.
            let show_id = cache_service::get_or_set_with_callback(
                ss,
                ApplicationCacheKey::TmdbEpisodeShowId(identifier.to_owned()),
                ApplicationCacheValue::TmdbEpisodeShowId,
                || find_show_on_tmdb(identifier, series_name, metadata, ss),
            )
            .await?
            .response
            .ok_or_else(|| {
                anyhow!("No show found with Series {series_name:#?} and Episode {identifier:#?}")
            })?;
            Ok((show_id, MediaLot::Show))
        }
        _ => bail!("Only movies and shows supported"),
    }
}

fn calculate_progress(payload: &models::PlexWebhookPayload) -> Result<Decimal> {
    match payload.metadata.view_offset {
        Some(offset) => Ok(offset / payload.metadata.duration * dec!(100)),
        None if payload.event_type == "media.scrobble" => Ok(dec!(100)),
        None => bail!("No position associated with this media"),
    }
}

pub async fn sink_progress(
    payload: String,
    plex_user: Option<String>,
    ss: &Arc<SupportingService>,
) -> Result<Option<ImportResult>> {
    let payload = parse_payload(&payload)?;

    let plex_user = plex_user
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty());
    if let Some(plex_user) = plex_user
        && plex_user != payload.account.plex_user
    {
        ryot_log!(
            debug,
            "Ignoring Plex webhook for user {:?}; integration is configured for {:?}",
            payload.account.plex_user,
            plex_user
        );
        return Ok(None);
    }

    match payload.event_type.as_str() {
        "media.scrobble" | "media.play" | "media.pause" | "media.resume" | "media.stop" => {}
        _ => {
            ryot_log!(
                debug,
                "Ignoring unsupported Plex webhook event {:?}",
                payload.event_type
            );
            return Ok(None);
        }
    };

    let identifier = get_tmdb_identifier(&payload.metadata.guids)?;
    let (identifier, lot) = get_media_info(identifier, ss, &payload.metadata).await?;
    let progress = calculate_progress(&payload)?;

    Ok(Some(ImportResult {
        completed: vec![ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
            lot,
            identifier,
            source: MediaSource::Tmdb,
            seen_history: vec![ImportOrExportMetadataItemSeen {
                progress: Some(progress),
                providers_consumed_on: Some(vec!["Plex".to_string()]),
                show_season_number: payload.metadata.season_number,
                show_episode_number: payload.metadata.episode_number,
                ..Default::default()
            }],
            ..Default::default()
        })],
        ..Default::default()
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn episode_payload_exposes_external_ids_for_show_lookup() {
        let payload = r#"{"event":"media.scrobble","user":true,"owner":false,"Account":{"title":"alice"},"Metadata":{"type":"episode","grandparentTitle":"Harry Hole","parentIndex":1,"index":1,"duration":3724736,"Guid":[{"id":"imdb://tt31841417"},{"id":"tmdb://5221957"},{"id":"tvdb://10394732"}]}}"#;
        let payload = parse_payload(payload).unwrap();
        assert_eq!(
            get_tmdb_identifier(&payload.metadata.guids).unwrap(),
            "5221957"
        );
        assert_eq!(
            get_episode_external_ids(&payload.metadata.guids),
            vec![("tt31841417", "imdb_id"), ("10394732", "tvdb_id")]
        );
    }

    #[test]
    fn episode_without_external_ids_has_no_show_lookup() {
        let guids = vec![StringIdObject {
            id: "tmdb://5221957".to_owned(),
        }];
        assert!(get_episode_external_ids(&guids).is_empty());
    }
}
