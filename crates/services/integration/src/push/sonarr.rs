use anyhow::Result;
use common_utils::ryot_log;
use enums::MediaLot;
use sonarr_api_rs::{
    apis::{
        configuration::{ApiKey as SonarrApiKey, Configuration as SonarrConfiguration},
        series_api::api_v3_series_post as sonarr_api_v3_series_post,
    },
    models::{AddSeriesOptions as SonarrAddSeriesOptions, SeriesResource as SonarrSeriesResource},
};
use traits::TraceOk;

pub(crate) struct SonarrPushIntegration {
    api_key: String,
    profile_id: i32,
    tvdb_id: String,
    base_url: String,
    metadata_lot: MediaLot,
    metadata_title: String,
    root_folder_path: String,
}

impl SonarrPushIntegration {
    pub const fn new(
        api_key: String,
        profile_id: i32,
        tvdb_id: String,
        base_url: String,
        metadata_lot: MediaLot,
        metadata_title: String,
        root_folder_path: String,
    ) -> Self {
        Self {
            tvdb_id,
            api_key,
            base_url,
            profile_id,
            metadata_lot,
            metadata_title,
            root_folder_path,
        }
    }

    pub async fn push_progress(&self) -> Result<()> {
        if self.metadata_lot != MediaLot::Show {
            ryot_log!(debug, "Not a show, skipping {:#?}", self.metadata_title);
            return Ok(());
        }
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
        resource.title = Some(Some(self.metadata_title.clone()));
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
