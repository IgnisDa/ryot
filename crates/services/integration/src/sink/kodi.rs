use anyhow::{bail, Result};
use dependent_models::ImportResult;
use enums::{MediaLot, MediaSource};
use media_models::{ImportOrExportMediaItem, ImportOrExportMediaItemSeen};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::integration_trait::YankIntegration;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct IntegrationMediaSeen {
    identifier: String,
    lot: MediaLot,
    progress: Decimal,
    show_season_number: Option<i32>,
    show_episode_number: Option<i32>,
}

pub(crate) struct KodiIntegration {
    payload: String,
}
impl KodiIntegration {
    pub const fn new(payload: String) -> Self {
        Self { payload }
    }

    async fn kodi_progress(&self) -> Result<ImportResult> {
        let payload = match serde_json::from_str::<IntegrationMediaSeen>(&self.payload) {
            Ok(val) => val,
            Err(err) => bail!(err),
        };

        Ok(ImportResult {
            media: vec![ImportOrExportMediaItem {
                lot: payload.lot,
                source: MediaSource::Tmdb,
                identifier: payload.identifier,
                seen_history: vec![ImportOrExportMediaItemSeen {
                    progress: Some(payload.progress),
                    show_season_number: payload.show_season_number,
                    show_episode_number: payload.show_episode_number,
                    provider_watched_on: Some("Kodi".to_string()),
                    ..Default::default()
                }],
                ..Default::default()
            }],
            ..Default::default()
        })
    }
}

impl YankIntegration for KodiIntegration {
    async fn yank_progress(&self) -> Result<ImportResult> {
        self.kodi_progress().await
    }
}
