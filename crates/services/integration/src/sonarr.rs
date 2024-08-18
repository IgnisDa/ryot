use sonarr_api_rs::{
    apis::{
        configuration::{ApiKey as SonarrApiKey, Configuration as SonarrConfiguration},
        series_api::api_v3_series_post as sonarr_api_v3_series_post,
    },
    models::{AddSeriesOptions as SonarrAddSeriesOptions, SeriesResource as SonarrSeriesResource},
};
use traits::TraceOk;

use super::integration::PushIntegration;

pub struct SonarrIntegration {
    sonarr_base_url: String,
    sonarr_api_key: String,
    sonarr_profile_id: i32,
    sonarr_root_folder_path: String,
    tvdb_id: String,
}

impl SonarrIntegration {
    pub const fn new(
        sonarr_base_url: String,
        sonarr_api_key: String,
        sonarr_profile_id: i32,
        sonarr_root_folder_path: String,
        tvdb_id: String,
    ) -> Self {
        Self {
            sonarr_base_url,
            sonarr_api_key,
            sonarr_profile_id,
            sonarr_root_folder_path,
            tvdb_id,
        }
    }

    async fn sonarr_push(&self) -> anyhow::Result<()> {
        let mut configuration = SonarrConfiguration::new();
        configuration.base_path = self.sonarr_base_url.clone();
        configuration.api_key = Some(SonarrApiKey {
            key: self.sonarr_api_key.clone(),
            prefix: None,
        });
        let mut resource = SonarrSeriesResource::new();
        resource.title = Some(Some(self.tvdb_id.clone()));
        resource.tvdb_id = Some(self.tvdb_id.parse().unwrap());
        resource.quality_profile_id = Some(self.sonarr_profile_id);
        resource.root_folder_path = Some(Some(self.sonarr_root_folder_path.clone()));
        resource.monitored = Some(true);
        resource.season_folder = Some(true);
        let mut options = SonarrAddSeriesOptions::new();
        options.search_for_missing_episodes = Some(true);
        resource.add_options = Some(Box::new(options));
        tracing::debug!("Pushing series to Sonarr {:?}", resource);
        sonarr_api_v3_series_post(&configuration, Some(resource))
            .await
            .trace_ok();
        Ok(())
    }
}

impl PushIntegration for SonarrIntegration {
    async fn push_progress(&self) -> anyhow::Result<()> {
        self.sonarr_push().await
    }
}
