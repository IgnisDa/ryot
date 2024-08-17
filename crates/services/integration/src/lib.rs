use anyhow::{bail, Result};
use database_models::metadata;
use enums::{MediaLot, MediaSource};
use media_models::{IntegrationMediaCollection, IntegrationMediaSeen};
use radarr_api_rs::{
    apis::{
        configuration::{ApiKey as RadarrApiKey, Configuration as RadarrConfiguration},
        movie_api::api_v3_movie_post as radarr_api_v3_movie_post,
    },
    models::{AddMovieOptions as RadarrAddMovieOptions, MovieResource as RadarrMovieResource},
};
use sea_orm::DatabaseConnection;
use sonarr_api_rs::{
    apis::{
        configuration::{ApiKey as SonarrApiKey, Configuration as SonarrConfiguration},
        series_api::api_v3_series_post as sonarr_api_v3_series_post,
    },
    models::{AddSeriesOptions as SonarrAddSeriesOptions, SeriesResource as SonarrSeriesResource},
};
use traits::TraceOk;

use crate::{
    integration::Integration,
    integration_type::IntegrationType,
    komga::KomgaIntegration
};
use crate::audiobookshelf::AudiobookshelfIntegration;
use crate::emby::EmbyIntegration;
use crate::jellyfin::JellyfinIntegration;
use crate::plex::PlexIntegration;

pub mod integration_type;
mod integration;

mod komga;
mod jellyfin;
mod emby;
mod show_identifier;
mod plex;
mod audiobookshelf;

#[derive(Debug)]
pub struct IntegrationService {
    db: DatabaseConnection,
}

impl IntegrationService {
    pub fn new(db: &DatabaseConnection) -> Self {
        Self { db: db.clone() }
    }

    pub async fn kodi_progress(&self, payload: &str) -> Result<IntegrationMediaSeen> {
        let mut payload = match serde_json::from_str::<IntegrationMediaSeen>(payload) {
            Result::Ok(val) => val,
            Result::Err(err) => bail!(err),
        };
        payload.source = MediaSource::Tmdb;
        payload.provider_watched_on = Some("Kodi".to_string());
        Ok(payload)
    }



    pub async fn radarr_push(
        &self,
        radarr_base_url: String,
        radarr_api_key: String,
        radarr_profile_id: i32,
        radarr_root_folder_path: String,
        tmdb_id: String,
    ) -> Result<()> {
        let mut configuration = RadarrConfiguration::new();
        configuration.base_path = radarr_base_url;
        configuration.api_key = Some(RadarrApiKey {
            key: radarr_api_key,
            prefix: None,
        });
        let mut resource = RadarrMovieResource::new();
        resource.tmdb_id = Some(tmdb_id.parse().unwrap());
        resource.quality_profile_id = Some(radarr_profile_id);
        resource.root_folder_path = Some(Some(radarr_root_folder_path.clone()));
        resource.monitored = Some(true);
        let mut options = RadarrAddMovieOptions::new();
        options.search_for_movie = Some(true);
        resource.add_options = Some(Box::new(options));
        tracing::debug!("Pushing movie to Radarr {:?}", resource);
        radarr_api_v3_movie_post(&configuration, Some(resource))
            .await
            .trace_ok();
        Ok(())
    }

    pub async fn sonarr_push(
        &self,
        sonarr_base_url: String,
        sonarr_api_key: String,
        sonarr_profile_id: i32,
        sonarr_root_folder_path: String,
        tvdb_id: String,
    ) -> Result<()> {
        let mut configuration = SonarrConfiguration::new();
        configuration.base_path = sonarr_base_url;
        configuration.api_key = Some(SonarrApiKey {
            key: sonarr_api_key,
            prefix: None,
        });
        let mut resource = SonarrSeriesResource::new();
        resource.title = Some(Some(tvdb_id.clone()));
        resource.tvdb_id = Some(tvdb_id.parse().unwrap());
        resource.quality_profile_id = Some(sonarr_profile_id);
        resource.root_folder_path = Some(Some(sonarr_root_folder_path.clone()));
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

    pub async fn process_progress(&self, integration_type: IntegrationType)
        -> Result<(Vec<IntegrationMediaSeen>, Vec<IntegrationMediaCollection>)> {
        match integration_type {
            IntegrationType::Komga(base_url, username, password, provider) => {
                let komga = KomgaIntegration::new(base_url, username, password, provider, self.db.clone());
                komga.progress().await
            }
            IntegrationType::Jellyfin(payload) => {
                let jellyfin = JellyfinIntegration::new(payload);
                jellyfin.progress().await
            }
            IntegrationType::Emby(payload) => {
                let emby = EmbyIntegration::new(payload, self.db.clone());
                emby.progress().await
            }
            IntegrationType::Plex(payload, plex_user) => {
                let plex = PlexIntegration::new(payload, plex_user, self.db.clone());
                plex.progress().await
            }
            IntegrationType::Audiobookshelf(base_url, access_token, isbn_service) => {
                let audiobookshelf = AudiobookshelfIntegration::new(base_url, access_token, isbn_service);
                audiobookshelf.progress().await
            }
        }
    }
}
