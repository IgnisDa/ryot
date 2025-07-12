use anyhow::{Result, bail};
use dependent_models::ImportOrExportMetadataItem;
use dependent_models::{ImportCompletedItem, ImportResult};
use enum_models::{MediaLot, MediaSource};
use media_models::ImportOrExportMetadataItemSeen;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct IntegrationMediaSeen {
    lot: MediaLot,
    progress: Decimal,
    identifier: String,
    show_season_number: Option<i32>,
    show_episode_number: Option<i32>,
}

pub async fn sink_progress(payload: String) -> Result<Option<ImportResult>> {
    let payload = match serde_json::from_str::<IntegrationMediaSeen>(&payload) {
        Ok(val) => val,
        Err(err) => bail!(err),
    };

    Ok(Some(ImportResult {
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
    }))
}
