use anyhow::{bail, Result};
use enums::{MediaLot, MediaSource};
use media_models::{IntegrationMediaCollection, IntegrationMediaSeen};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};

use super::integration_trait::YankIntegration;

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
        pub run_time_ticks: Option<Decimal>,
        #[serde(rename = "Type")]
        pub item_type: String,
        pub provider_ids: JellyfinWebhookItemProviderIdsPayload,
        #[serde(rename = "ParentIndexNumber")]
        pub season_number: Option<i32>,
        #[serde(rename = "IndexNumber")]
        pub episode_number: Option<i32>,
    }
    #[derive(Serialize, Deserialize, Debug, Clone)]
    #[serde(rename_all = "PascalCase")]
    pub struct JellyfinWebhookPayload {
        pub event: Option<String>,
        pub item: JellyfinWebhookItemPayload,
        pub series: Option<JellyfinWebhookItemPayload>,
        pub session: JellyfinWebhookSessionPayload,
    }
}

pub(crate) struct JellyfinIntegration {
    payload: String,
}

impl JellyfinIntegration {
    pub const fn new(payload: String) -> Self {
        Self { payload }
    }

    async fn jellyfin_progress(
        &self,
    ) -> Result<(Vec<IntegrationMediaSeen>, Vec<IntegrationMediaCollection>)> {
        let payload = serde_json::from_str::<models::JellyfinWebhookPayload>(&self.payload)?;
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

        let runtime = payload
            .item
            .run_time_ticks
            .ok_or_else(|| anyhow::anyhow!("No run time associated with this media"))?;

        let position = payload
            .session
            .play_state
            .position_ticks
            .ok_or_else(|| anyhow::anyhow!("No position associated with this media"))?;

        let lot = match payload.item.item_type.as_str() {
            "Episode" => MediaLot::Show,
            "Movie" => MediaLot::Movie,
            _ => bail!("Only movies and shows supported"),
        };

        Ok((
            vec![IntegrationMediaSeen {
                identifier,
                lot,
                source: MediaSource::Tmdb,
                progress: position / runtime * dec!(100),
                show_season_number: payload.item.season_number,
                show_episode_number: payload.item.episode_number,
                provider_watched_on: Some("Jellyfin".to_string()),
                ..Default::default()
            }],
            vec![],
        ))
    }
}

impl YankIntegration for JellyfinIntegration {
    async fn yank_progress(
        &self,
    ) -> Result<(Vec<IntegrationMediaSeen>, Vec<IntegrationMediaCollection>)> {
        self.jellyfin_progress().await
    }
}
