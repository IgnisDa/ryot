use anyhow::Result;
use dependent_models::{ImportCompletedItem, ImportResult};
use enum_models::{MediaLot, MediaSource};
use media_models::{ImportOrExportMetadataItem, ImportOrExportMetadataItemSeen};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};

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
    pub struct JellyfinWebhookPayload {
        pub event: Option<String>,
        pub item: JellyfinWebhookItemPayload,
        pub series: Option<JellyfinWebhookItemPayload>,
        pub session: Option<JellyfinWebhookSessionPayload>,
    }
}

pub async fn sink_progress(payload: String) -> Result<Option<ImportResult>> {
    let payload = serde_json::from_str::<models::JellyfinWebhookPayload>(&payload)?;
    let identifier = payload
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
        .ok_or_else(|| anyhow::anyhow!("No TMDb ID associated with this media"))?
        .clone();

    let lot = match payload.item.item_type.as_str() {
        "Episode" => MediaLot::Show,
        "Movie" => MediaLot::Movie,
        _ => return Ok(None),
    };

    let mut seen_item = ImportOrExportMetadataItemSeen {
        show_season_number: payload.item.season_number,
        show_episode_number: payload.item.episode_number,
        provider_watched_on: Some("Jellyfin".to_string()),
        ..Default::default()
    };

    match payload.event.unwrap_or_default().as_str() {
        "MarkPlayed" => {}
        _ => {
            let runtime = payload
                .item
                .run_time_ticks
                .ok_or_else(|| anyhow::anyhow!("No run time associated with this media"))?;

            let position = payload
                .session
                .as_ref()
                .and_then(|s| s.play_state.position_ticks.as_ref())
                .ok_or_else(|| anyhow::anyhow!("No position associated with this media"))?;

            seen_item.progress = Some(position / runtime * dec!(100));
        }
    }

    Ok(Some(ImportResult {
        completed: vec![ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
            lot,
            identifier,
            source: MediaSource::Tmdb,
            seen_history: vec![seen_item],
            ..Default::default()
        })],
        ..Default::default()
    }))
}
