use std::sync::Arc;

use anyhow::{Context, Result, anyhow, bail};
use common_models::StringIdObject;
use dependent_models::{ImportCompletedItem, ImportOrExportMetadataItem, ImportResult};
use enum_models::{MediaLot, MediaSource};
use media_models::ImportOrExportMetadataItemSeen;
use regex::Regex;
use rust_decimal::{Decimal, dec};
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;

use crate::utils::get_show_by_episode_identifier;

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

async fn get_media_info<'a>(
    identifier: &'a str,
    ss: &Arc<SupportingService>,
    metadata: &'a models::PlexWebhookMetadataPayload,
) -> Result<(String, MediaLot)> {
    match metadata.item_type.as_str() {
        "movie" => Ok((identifier.to_owned(), MediaLot::Movie)),
        "episode" => {
            let series_name = metadata.show_name.as_ref().context("Show name missing")?;
            let db_show = get_show_by_episode_identifier(series_name, identifier, ss).await?;
            Ok((db_show.identifier, MediaLot::Show))
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

    if let Some(plex_user) = &plex_user
        && *plex_user != payload.account.plex_user
    {
        return Ok(None);
    }

    match payload.event_type.as_str() {
        "media.scrobble" | "media.play" | "media.pause" | "media.resume" | "media.stop" => {}
        _ => return Ok(None),
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
