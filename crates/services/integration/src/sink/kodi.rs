use anyhow::{bail, Result};
use dependent_models::ImportResult;
use enums::MediaSource;
use media_models::{ImportOrExportMediaItem, ImportOrExportMediaItemSeen, IntegrationMediaSeen};

use crate::integration_trait::YankIntegration;

pub(crate) struct KodiIntegration {
    payload: String,
}
impl KodiIntegration {
    pub const fn new(payload: String) -> Self {
        Self { payload }
    }

    async fn kodi_progress(&self) -> Result<ImportResult> {
        let mut payload = match serde_json::from_str::<IntegrationMediaSeen>(&self.payload) {
            Ok(val) => val,
            Err(err) => bail!(err),
        };
        payload.source = MediaSource::Tmdb;
        payload.provider_watched_on = Some("Kodi".to_string());

        Ok(ImportResult {
            media: vec![ImportOrExportMediaItem {
                lot: payload.lot,
                source: payload.source,
                identifier: payload.identifier,
                source_id: "".to_string(),
                seen_history: vec![ImportOrExportMediaItemSeen {
                    progress: Some(payload.progress),
                    show_season_number: payload.show_season_number,
                    show_episode_number: payload.show_episode_number,
                    provider_watched_on: payload.provider_watched_on,
                    ..Default::default()
                }],
                reviews: vec![],
                collections: vec![],
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
