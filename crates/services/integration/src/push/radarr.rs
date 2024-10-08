use common_utils::ryot_log;
use radarr_api_rs::{
    apis::{
        configuration::{ApiKey as RadarrApiKey, Configuration as RadarrConfiguration},
        movie_api::api_v3_movie_post as radarr_api_v3_movie_post,
    },
    models::{AddMovieOptions as RadarrAddMovieOptions, MovieResource as RadarrMovieResource},
};
use traits::TraceOk;

use crate::traita::PushIntegration;

pub(crate) struct RadarrIntegration {
    radarr_base_url: String,
    radarr_api_key: String,
    radarr_profile_id: i32,
    radarr_root_folder_path: String,
    tmdb_id: String,
}

impl RadarrIntegration {
    pub const fn new(
        radarr_base_url: String,
        radarr_api_key: String,
        radarr_profile_id: i32,
        radarr_root_folder_path: String,
        tmdb_id: String,
    ) -> Self {
        Self {
            radarr_base_url,
            radarr_api_key,
            radarr_profile_id,
            radarr_root_folder_path,
            tmdb_id,
        }
    }

    async fn radarr_push(&self) -> anyhow::Result<()> {
        let mut configuration = RadarrConfiguration::new();
        configuration.base_path = self.radarr_base_url.clone();
        configuration.api_key = Some(RadarrApiKey {
            key: self.radarr_api_key.clone(),
            prefix: None,
        });
        let mut resource = RadarrMovieResource::new();
        resource.tmdb_id = Some(self.tmdb_id.parse().unwrap());
        resource.quality_profile_id = Some(self.radarr_profile_id);
        resource.root_folder_path = Some(Some(self.radarr_root_folder_path.clone()));
        resource.monitored = Some(true);
        let mut options = RadarrAddMovieOptions::new();
        options.search_for_movie = Some(true);
        resource.add_options = Some(Box::new(options));
        ryot_log!(debug, "Pushing movie to Radarr {:?}", resource);
        radarr_api_v3_movie_post(&configuration, Some(resource))
            .await
            .trace_ok();
        Ok(())
    }
}

impl PushIntegration for RadarrIntegration {
    async fn push_progress(&self) -> anyhow::Result<()> {
        self.radarr_push().await
    }
}
