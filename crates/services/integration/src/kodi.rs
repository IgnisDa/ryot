use anyhow::bail;
use enums::MediaSource;
use media_models::{IntegrationMediaCollection, IntegrationMediaSeen};

use super::integration_trait::YankIntegration;

pub(crate) struct KodiIntegration {
    payload: String,
}
impl KodiIntegration {
    pub const fn new(payload: String) -> Self {
        Self { payload }
    }

    async fn kodi_progress(
        &self,
    ) -> anyhow::Result<(Vec<IntegrationMediaSeen>, Vec<IntegrationMediaCollection>)> {
        let mut payload = match serde_json::from_str::<IntegrationMediaSeen>(&self.payload) {
            Ok(val) => val,
            Err(err) => bail!(err),
        };
        payload.source = MediaSource::Tmdb;
        payload.provider_watched_on = Some("Kodi".to_string());
        Ok((vec![payload], vec![]))
    }
}

impl YankIntegration for KodiIntegration {
    async fn yank_progress(
        &self,
    ) -> anyhow::Result<(Vec<IntegrationMediaSeen>, Vec<IntegrationMediaCollection>)> {
        self.kodi_progress().await
    }
}
