use common_utils::ryot_log;
use radarr_api_rs::{
    apis::{
        configuration::{ApiKey as RadarrApiKey, Configuration as RadarrConfiguration},
        movie_api::api_v3_movie_post as radarr_api_v3_movie_post,
    },
    models::{AddMovieOptions as RadarrAddMovieOptions, MovieResource as RadarrMovieResource},
};
use traits::TraceOk;

pub(crate) struct RadarrPushIntegration {
    base_url: String,
    api_key: String,
    profile_id: i32,
    root_folder_path: String,
    tmdb_id: String,
}

impl RadarrPushIntegration {
    pub const fn new(
        base_url: String,
        api_key: String,
        profile_id: i32,
        root_folder_path: String,
        tmdb_id: String,
    ) -> Self {
        Self {
            base_url,
            api_key,
            profile_id,
            root_folder_path,
            tmdb_id,
        }
    }

    pub async fn push_progress(&self) -> anyhow::Result<()> {
        let mut configuration = RadarrConfiguration::new();
        configuration.base_path = self.base_url.clone();
        configuration.api_key = Some(RadarrApiKey {
            key: self.api_key.clone(),
            prefix: None,
        });
        let mut resource = RadarrMovieResource::new();
        resource.tmdb_id = Some(self.tmdb_id.parse().unwrap());
        resource.quality_profile_id = Some(self.profile_id);
        resource.root_folder_path = Some(Some(self.root_folder_path.clone()));
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
