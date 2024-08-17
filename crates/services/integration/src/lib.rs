use std::future::Future;

use anyhow::{anyhow, bail, Result};
use application_utils::get_base_http_client;
use async_graphql::Result as GqlResult;
use database_models::metadata;
use enums::{MediaLot, MediaSource};
use media_models::{CommitMediaInput, IntegrationMediaCollection, IntegrationMediaSeen};
use providers::google_books::GoogleBooksService;
use radarr_api_rs::{
    apis::{
        configuration::{ApiKey as RadarrApiKey, Configuration as RadarrConfiguration},
        movie_api::api_v3_movie_post as radarr_api_v3_movie_post,
    },
    models::{AddMovieOptions as RadarrAddMovieOptions, MovieResource as RadarrMovieResource},
};
use reqwest::header::{HeaderValue, AUTHORIZATION};
use rust_decimal_macros::dec;
use sea_orm::DatabaseConnection;
use sonarr_api_rs::{
    apis::{
        configuration::{ApiKey as SonarrApiKey, Configuration as SonarrConfiguration},
        series_api::api_v3_series_post as sonarr_api_v3_series_post,
    },
    models::{AddSeriesOptions as SonarrAddSeriesOptions, SeriesResource as SonarrSeriesResource},
};
use specific_models::audiobookshelf as audiobookshelf_models;
use traits::TraceOk;

use crate::{
    integration::Integration,
    integration_type::IntegrationType,
    komga::KomgaIntegration
};
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

    pub async fn audiobookshelf_progress<F>(
        &self,
        base_url: &str,
        access_token: &str,
        isbn_service: &GoogleBooksService,
        commit_metadata: impl Fn(CommitMediaInput) -> F,
    ) -> Result<(Vec<IntegrationMediaSeen>, Vec<IntegrationMediaCollection>)>
    where
        F: Future<Output = GqlResult<metadata::Model>>,
    {
        let client = get_base_http_client(
            &format!("{}/api/", base_url),
            Some(vec![(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {access_token}")).unwrap(),
            )]),
        );
        let resp = client
            .get("me/items-in-progress")
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json::<audiobookshelf_models::Response>()
            .await
            .unwrap();
        tracing::debug!("Got response for items in progress {:?}", resp);
        let mut media_items = vec![];
        for item in resp.library_items.iter() {
            let metadata = item.media.clone().unwrap().metadata;
            let (progress_id, identifier, lot, source, podcast_episode_number) =
                if Some("epub".to_string()) == item.media.as_ref().unwrap().ebook_format {
                    match &metadata.isbn {
                        Some(isbn) => match isbn_service.id_from_isbn(isbn).await {
                            Some(id) => (
                                item.id.clone(),
                                id,
                                MediaLot::Book,
                                MediaSource::GoogleBooks,
                                None,
                            ),
                            _ => {
                                tracing::debug!("No Google Books ID found for ISBN {:#?}", isbn);
                                continue;
                            }
                        },
                        _ => {
                            tracing::debug!("No ISBN found for item {:#?}", item);
                            continue;
                        }
                    }
                } else if let Some(asin) = metadata.asin.clone() {
                    (
                        item.id.clone(),
                        asin,
                        MediaLot::AudioBook,
                        MediaSource::Audible,
                        None,
                    )
                } else if let Some(itunes_id) = metadata.itunes_id.clone() {
                    match &item.recent_episode {
                        Some(pe) => {
                            let lot = MediaLot::Podcast;
                            let source = MediaSource::Itunes;
                            let podcast = commit_metadata(CommitMediaInput {
                                identifier: itunes_id.clone(),
                                lot,
                                source,
                                ..Default::default()
                            })
                            .await
                            .unwrap();
                            match podcast
                                .podcast_specifics
                                .and_then(|p| p.episode_by_name(&pe.title))
                            {
                                Some(episode) => (
                                    format!("{}/{}", item.id, pe.id),
                                    itunes_id,
                                    lot,
                                    source,
                                    Some(episode),
                                ),
                                _ => {
                                    tracing::debug!(
                                        "No podcast found for iTunes ID {:#?}",
                                        itunes_id
                                    );
                                    continue;
                                }
                            }
                        }
                        _ => {
                            tracing::debug!("No recent episode found for item {:#?}", item);
                            continue;
                        }
                    }
                } else {
                    tracing::debug!("No ASIN, ISBN or iTunes ID found for item {:#?}", item);
                    continue;
                };
            match client
                .get(format!("me/progress/{}", progress_id))
                .send()
                .await
                .map_err(|e| anyhow!(e))?
                .json::<audiobookshelf_models::ItemProgress>()
                .await
            {
                Ok(resp) => {
                    tracing::debug!("Got response for individual item progress {:?}", resp);
                    let progress = if let Some(ebook_progress) = resp.ebook_progress {
                        ebook_progress
                    } else {
                        resp.progress
                    };
                    media_items.push(IntegrationMediaSeen {
                        lot,
                        source,
                        identifier,
                        podcast_episode_number,
                        progress: progress * dec!(100),
                        provider_watched_on: Some("Audiobookshelf".to_string()),
                        ..Default::default()
                    });
                }
                _ => {
                    tracing::debug!("No progress found for item {:?}", item);
                    continue;
                }
            };
        }
        Ok((media_items, vec![]))
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
        }
    }
}
