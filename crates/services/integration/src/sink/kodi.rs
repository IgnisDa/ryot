use anyhow::{bail, Result};
use dependent_models::{ImportCompletedItem, ImportResult};
use enums::{MediaLot, MediaSource};
use media_models::{ImportOrExportMetadataItem, ImportOrExportMetadataItemSeen};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct IntegrationMediaSeen {
    identifier: String,
    lot: MediaLot,
    progress: Decimal,
    show_season_number: Option<i32>,
    show_episode_number: Option<i32>,
}

pub(crate) struct KodiSinkIntegration {
    payload: String,
}
impl KodiSinkIntegration {
    pub const fn new(payload: String) -> Self {
        Self { payload }
    }

    pub async fn yank_progress(&self) -> Result<ImportResult> {
        let payload = match serde_json::from_str::<IntegrationMediaSeen>(&self.payload) {
            Ok(val) => val,
            Err(err) => bail!(err),
        };

        Ok(ImportResult {
            completed: vec![ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
                lot: payload.lot,
                source: MediaSource::Tmdb,
                identifier: payload.identifier,
                seen_history: vec![ImportOrExportMetadataItemSeen {
                    progress: Some(payload.progress),
                    provider_watched_on: Some("Kodi".to_string()),
                    show_season_number: payload.show_season_number,
                    show_episode_number: payload.show_episode_number,
                    ..Default::default()
                }],
                ..Default::default()
            })],
            ..Default::default()
        })
    }
}
