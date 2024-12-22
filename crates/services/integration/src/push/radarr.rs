use anyhow::Result;
use common_utils::ryot_log;
use enum_models::MediaLot;
use radarr_api_rs::{
    apis::{
        configuration::{ApiKey as RadarrApiKey, Configuration as RadarrConfiguration},
        movie_api::api_v3_movie_post as radarr_api_v3_movie_post,
    },
    models::{AddMovieOptions as RadarrAddMovieOptions, MovieResource as RadarrMovieResource},
};
use traits::TraceOk;

pub async fn push_progress(
    api_key: String,
    profile_id: i32,
    tmdb_id: String,
    base_url: String,
    metadata_lot: MediaLot,
    metadata_title: String,
    root_folder_path: String,
) -> Result<()> {
    if metadata_lot != MediaLot::Movie {
        ryot_log!(debug, "Not a movie, skipping {:#?}", metadata_title);
        return Ok(());
    }
    let mut configuration = RadarrConfiguration::new();
    configuration.base_path = base_url.clone();
    configuration.api_key = Some(RadarrApiKey {
        prefix: None,
        key: api_key.clone(),
    });
    let mut resource = RadarrMovieResource::new();
    resource.tmdb_id = Some(tmdb_id.parse().unwrap());
    resource.quality_profile_id = Some(profile_id);
    resource.root_folder_path = Some(Some(root_folder_path.clone()));
    resource.monitored = Some(true);
    resource.title = Some(Some(metadata_title.clone()));
    let mut options = RadarrAddMovieOptions::new();
    options.search_for_movie = Some(true);
    resource.add_options = Some(Box::new(options));
    ryot_log!(debug, "Pushing movie to Radarr {:?}", resource);
    radarr_api_v3_movie_post(&configuration, Some(resource))
        .await
        .trace_ok();
    Ok(())
}
