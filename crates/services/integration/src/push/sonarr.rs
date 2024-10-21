use common_utils::ryot_log;
use sonarr_api_rs::{
    apis::{
        configuration::{ApiKey as SonarrApiKey, Configuration as SonarrConfiguration},
        series_api::api_v3_series_post as sonarr_api_v3_series_post,
    },
    models::{AddSeriesOptions as SonarrAddSeriesOptions, SeriesResource as SonarrSeriesResource},
};
use traits::TraceOk;

pub(crate) struct SonarrPushIntegration {
    base_url: String,
    api_key: String,
    profile_id: i32,
    root_folder_path: String,
    tvdb_id: String,
}

impl SonarrPushIntegration {
    pub const fn new(
        base_url: String,
        api_key: String,
        profile_id: i32,
        root_folder_path: String,
        tvdb_id: String,
    ) -> Self {
        Self {
            base_url,
            api_key,
            profile_id,
            root_folder_path,
            tvdb_id,
        }
    }

    pub async fn push_progress(&self) -> anyhow::Result<()> {
        let mut configuration = SonarrConfiguration::new();
        configuration.base_path = self.base_url.clone();
        configuration.api_key = Some(SonarrApiKey {
            key: self.api_key.clone(),
            prefix: None,
        });
        let mut resource = SonarrSeriesResource::new();
        resource.title = Some(Some(self.tvdb_id.clone()));
        resource.tvdb_id = Some(self.tvdb_id.parse().unwrap());
        resource.quality_profile_id = Some(self.profile_id);
        resource.root_folder_path = Some(Some(self.root_folder_path.clone()));
        resource.monitored = Some(true);
        resource.season_folder = Some(true);
        let mut options = SonarrAddSeriesOptions::new();
        options.search_for_missing_episodes = Some(true);
        resource.add_options = Some(Box::new(options));
        ryot_log!(debug, "Pushing series to Sonarr {:?}", resource);
        sonarr_api_v3_series_post(&configuration, Some(resource))
            .await
            .trace_ok();
        Ok(())
    }
}
