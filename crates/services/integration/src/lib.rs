use std::future::Future;

use crate::{
    audiobookshelf::AudiobookshelfIntegration, emby::EmbyIntegration,
    integration_trait::PushIntegration, integration_trait::YankIntegration,
    integration_trait::YankIntegrationWithCommit, integration_type::IntegrationType,
    jellyfin::JellyfinIntegration, kodi::KodiIntegration, komga::KomgaIntegration,
    plex::PlexIntegration, radarr::RadarrIntegration, sonarr::SonarrIntegration,
};
use anyhow::Result;
use async_graphql::Result as GqlResult;
use database_models::metadata;
use media_models::{CommitMediaInput, IntegrationMediaCollection, IntegrationMediaSeen};
use sea_orm::DatabaseConnection;

mod audiobookshelf;
mod emby;
mod integration_trait;
pub mod integration_type;
mod jellyfin;
mod kodi;
mod komga;
mod plex;
mod radarr;
mod sonarr;

#[derive(Debug)]
pub struct IntegrationService {
    db: DatabaseConnection,
}

impl IntegrationService {
    pub fn new(db: &DatabaseConnection) -> Self {
        Self { db: db.clone() }
    }
    pub async fn push(&self, integration_type: IntegrationType) -> Result<()> {
        match integration_type {
            IntegrationType::Sonarr(
                sonarr_base_url,
                sonarr_api_key,
                sonarr_profile_id,
                sonarr_root_folder_path,
                tvdb_id,
            ) => {
                let sonarr = SonarrIntegration::new(
                    sonarr_base_url,
                    sonarr_api_key,
                    sonarr_profile_id,
                    sonarr_root_folder_path,
                    tvdb_id,
                );
                sonarr.push_progress().await
            }
            IntegrationType::Radarr(
                radarr_base_url,
                radarr_api_key,
                radarr_profile_id,
                radarr_root_folder_path,
                tmdb_id,
            ) => {
                let radarr = RadarrIntegration::new(
                    radarr_base_url,
                    radarr_api_key,
                    radarr_profile_id,
                    radarr_root_folder_path,
                    tmdb_id,
                );
                radarr.push_progress().await
            }
            _ => Err(anyhow::anyhow!("Unsupported integration type")),
        }
    }

    pub async fn process_progress(
        &self,
        integration_type: IntegrationType,
    ) -> Result<(Vec<IntegrationMediaSeen>, Vec<IntegrationMediaCollection>)> {
        match integration_type {
            IntegrationType::Jellyfin(payload) => {
                let jellyfin = JellyfinIntegration::new(payload);
                jellyfin.yank_progress().await
            }
            IntegrationType::Emby(payload) => {
                let emby = EmbyIntegration::new(payload, self.db.clone());
                emby.yank_progress().await
            }
            IntegrationType::Plex(payload, plex_user) => {
                let plex = PlexIntegration::new(payload, plex_user, self.db.clone());
                plex.yank_progress().await
            }
            IntegrationType::Kodi(payload) => {
                let kodi = KodiIntegration::new(payload);
                kodi.yank_progress().await
            }
            _ => Err(anyhow::anyhow!("Unsupported integration type")),
        }
    }

    pub async fn process_progress_commit<F>(
        &self,
        integration_type: IntegrationType,
        commit_metadata: impl Fn(CommitMediaInput) -> F,
    ) -> Result<(Vec<IntegrationMediaSeen>, Vec<IntegrationMediaCollection>)>
    where
        F: Future<Output = GqlResult<metadata::Model>>,
    {
        match integration_type {
            IntegrationType::Audiobookshelf(
                base_url,
                access_token,
                sync_to_owned_collection,
                isbn_service,
            ) => {
                let audiobookshelf = AudiobookshelfIntegration::new(
                    base_url,
                    access_token,
                    sync_to_owned_collection,
                    isbn_service,
                );
                audiobookshelf.yank_progress(commit_metadata).await
            }
            IntegrationType::Komga(
                base_url,
                username,
                password,
                provider,
                sync_to_owned_collection,
            ) => {
                let komga = KomgaIntegration::new(
                    base_url,
                    username,
                    password,
                    provider,
                    self.db.clone(),
                    sync_to_owned_collection,
                );
                komga.yank_progress().await
            }
            _ => Err(anyhow::anyhow!("Unsupported integration type")),
        }
    }
}
