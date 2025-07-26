use anyhow::{Result, bail};
use dependent_models::{ImportCompletedItem, ImportOrExportMetadataItem, ImportResult};
use enum_models::MediaSource;
use media_models::ImportOrExportMetadataItemSeen;

use crate::utils::IntegrationMediaSeen;

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
