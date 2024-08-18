use anyhow::Result;
use sea_orm::DatabaseConnection;

use database_models::metadata;
use enums::{MediaLot, MediaSource};
use media_models::{IntegrationMediaCollection, IntegrationMediaSeen};

use crate::{
    audiobookshelf::AudiobookshelfIntegration, emby::EmbyIntegration, integration::Integration,
    integration::PushIntegration, integration_type::IntegrationType, jellyfin::JellyfinIntegration,
    kodi::KodiIntegration, komga::KomgaIntegration, plex::PlexIntegration,
    radarr::RadarrIntegration, sonarr::SonarrIntegration,
};

mod audiobookshelf;
mod emby;
mod integration;
pub mod integration_type;
mod jellyfin;
mod kodi;
mod komga;
mod plex;
mod radarr;
mod show_identifier;
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
                sonarr.push().await
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
                radarr.push().await
            }
            _ => Ok(()),
        }
    }

    pub async fn process_progress(
        &self,
        integration_type: IntegrationType,
    ) -> Result<(Vec<IntegrationMediaSeen>, Vec<IntegrationMediaCollection>)> {
        match integration_type {
            IntegrationType::Komga(base_url, username, password, provider) => {
                let komga =
                    KomgaIntegration::new(base_url, username, password, provider, self.db.clone());
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
                let audiobookshelf =
                    AudiobookshelfIntegration::new(base_url, access_token, isbn_service);
                audiobookshelf.progress().await
            }
            IntegrationType::Kodi(payload) => {
                let kodi = KodiIntegration::new(payload);
                kodi.progress().await
            }
            _ => Ok((vec![], vec![])),
        }
    }
}
