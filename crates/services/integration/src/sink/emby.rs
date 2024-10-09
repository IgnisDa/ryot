use anyhow::{bail, Result};
use dependent_models::ImportResult;
use enums::{MediaLot, MediaSource};
use media_models::{ImportOrExportMediaItem, ImportOrExportMediaItemSeen};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use sea_orm::prelude::async_trait::async_trait;
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};

use crate::utils::ShowIdentifier;

mod models {
    use super::*;

    #[derive(Serialize, Deserialize, Debug, Clone)]
    #[serde(rename_all = "PascalCase")]
    pub struct EmbyWebhookPlaybackInfoPayload {
        pub position_ticks: Option<Decimal>,
    }
    #[derive(Serialize, Deserialize, Debug, Clone)]
    #[serde(rename_all = "PascalCase")]
    pub struct EmbyWebhookItemProviderIdsPayload {
        pub tmdb: Option<String>,
    }
    #[derive(Serialize, Deserialize, Debug, Clone)]
    #[serde(rename_all = "PascalCase")]
    pub struct EmbyWebhookItemPayload {
        pub run_time_ticks: Option<Decimal>,
        #[serde(rename = "Type")]
        pub item_type: String,
        pub provider_ids: EmbyWebhookItemProviderIdsPayload,
        #[serde(rename = "ParentIndexNumber")]
        pub season_number: Option<i32>,
        #[serde(rename = "IndexNumber")]
        pub episode_number: Option<i32>,
        #[serde(rename = "Name")]
        pub episode_name: Option<String>,
        pub series_name: Option<String>,
    }
    #[derive(Serialize, Deserialize, Debug, Clone)]
    #[serde(rename_all = "PascalCase")]
    pub struct EmbyWebhookPayload {
        pub event: Option<String>,
        pub item: EmbyWebhookItemPayload,
        pub series: Option<EmbyWebhookItemPayload>,
        pub playback_info: EmbyWebhookPlaybackInfoPayload,
    }
}

pub(crate) struct EmbyIntegration {
    payload: String,
    db: DatabaseConnection,
}

impl EmbyIntegration {
    pub const fn new(payload: String, db: DatabaseConnection) -> Self {
        Self { payload, db }
    }

    async fn emby_progress(&self) -> Result<ImportResult> {
        let payload: models::EmbyWebhookPayload = serde_json::from_str(&self.payload)?;

        let runtime = payload
            .item
            .run_time_ticks
            .ok_or_else(|| anyhow::anyhow!("No run time associated with this media"))?;
        let position = payload
            .playback_info
            .position_ticks
            .ok_or_else(|| anyhow::anyhow!("No position associated with this media"))?;

        let (identifier, lot) =
            match payload.item.item_type.as_str() {
                "Movie" => {
                    let id =
                        payload.item.provider_ids.tmdb.as_ref().ok_or_else(|| {
                            anyhow::anyhow!("No TMDb ID associated with this media")
                        })?;
                    (id.clone(), MediaLot::Movie)
                }
                "Episode" => {
                    let series_name = payload.item.series_name.as_ref().ok_or_else(|| {
                        anyhow::anyhow!("No series name associated with this media")
                    })?;
                    let episode_name = payload.item.episode_name.as_ref().ok_or_else(|| {
                        anyhow::anyhow!("No episode name associated with this media")
                    })?;
                    let db_show = self
                        .get_show_by_episode_identifier(series_name, episode_name)
                        .await?;
                    (db_show.identifier, MediaLot::Show)
                }
                _ => bail!("Only movies and shows supported"),
            };

        Ok(ImportResult {
            media: vec![ImportOrExportMediaItem {
                lot,
                identifier,
                source: MediaSource::Tmdb,
                seen_history: vec![ImportOrExportMediaItemSeen {
                    progress: Some(position / runtime * dec!(100)),
                    show_season_number: payload.item.season_number,
                    show_episode_number: payload.item.episode_number,
                    provider_watched_on: Some("Emby".to_string()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        })
    }

    pub async fn yank_progress(&self) -> Result<ImportResult> {
        self.emby_progress().await
    }
}

#[async_trait]
impl ShowIdentifier for EmbyIntegration {
    fn get_db(&self) -> &DatabaseConnection {
        &self.db
    }
}
