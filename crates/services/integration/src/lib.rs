use std::future::Future;
use std::sync::Arc;

use anyhow::Result;
use apalis::prelude::MemoryStorage;
use async_graphql::{Error, Result as GqlResult};
use background::CoreApplicationJob;
use chrono::Utc;
use common_models::ChangeCollectionToEntityInput;
use common_utils::ryot_log;
use database_models::metadata;
use database_models::{integration, prelude::Integration};
use database_utils::{add_entity_to_collection, user_preferences_by_id};
use enums::{EntityLot, IntegrationLot, IntegrationProvider};
use media_models::{CommitMediaInput, IntegrationMediaCollection, IntegrationMediaSeen};
use providers::google_books::GoogleBooksService;
use rust_decimal_macros::dec;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QuerySelect,
};
use sea_query::Expr;
use traits::TraceOk;

mod audiobookshelf;
mod emby;
mod integration_trait;
mod integration_type;
mod jellyfin;
mod kodi;
mod komga;
mod plex;
mod radarr;
mod sonarr;

use crate::{
    audiobookshelf::AudiobookshelfIntegration, emby::EmbyIntegration,
    integration_trait::PushIntegration, integration_trait::YankIntegration,
    integration_trait::YankIntegrationWithCommit, integration_type::IntegrationType,
    jellyfin::JellyfinIntegration, kodi::KodiIntegration, komga::KomgaIntegration,
    plex::PlexIntegration, radarr::RadarrIntegration, sonarr::SonarrIntegration,
};

#[derive(Debug)]
pub struct IntegrationService {
    db: DatabaseConnection,
    config: Arc<config::AppConfig>,
    perform_core_application_job: MemoryStorage<CoreApplicationJob>,
}

impl IntegrationService {
    pub fn new(
        db: &DatabaseConnection,
        config: Arc<config::AppConfig>,
        perform_core_application_job: &MemoryStorage<CoreApplicationJob>,
    ) -> Self {
        Self {
            config,
            db: db.clone(),
            perform_core_application_job: perform_core_application_job.clone(),
        }
    }

    async fn push(&self, integration_type: IntegrationType) -> Result<()> {
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

    async fn process_progress(
        &self,
        integration_type: IntegrationType,
    ) -> Result<(Vec<IntegrationMediaSeen>, Vec<IntegrationMediaCollection>)> {
        match integration_type {
            IntegrationType::Komga(base_url, username, password, provider) => {
                let komga =
                    KomgaIntegration::new(base_url, username, password, provider, self.db.clone());
                komga.yank_progress().await
            }
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

    async fn process_progress_commit<F>(
        &self,
        integration_type: IntegrationType,
        commit_metadata: impl Fn(CommitMediaInput) -> F,
    ) -> Result<(Vec<IntegrationMediaSeen>, Vec<IntegrationMediaCollection>)>
    where
        F: Future<Output = GqlResult<metadata::Model>>,
    {
        match integration_type {
            IntegrationType::Audiobookshelf(base_url, access_token, isbn_service) => {
                let audiobookshelf =
                    AudiobookshelfIntegration::new(base_url, access_token, isbn_service);
                audiobookshelf.yank_progress(commit_metadata).await
            }
            _ => Err(anyhow::anyhow!("Unsupported integration type")),
        }
    }

    pub async fn process_integration_webhook(
        &self,
        integration_slug: String,
        payload: String,
    ) -> GqlResult<String> {
        ryot_log!(
            debug,
            "Processing integration webhook for slug: {}",
            integration_slug
        );
        let integration = Integration::find_by_id(integration_slug)
            .one(&self.db)
            .await?
            .ok_or_else(|| Error::new("Integration does not exist".to_owned()))?;
        let preferences =
            user_preferences_by_id(&self.db, &integration.user_id, &self.config).await?;
        if integration.is_disabled.unwrap_or_default() || preferences.general.disable_integrations {
            return Err(Error::new("Integration is disabled".to_owned()));
        }
        let maybe_progress_update = match integration.provider {
            IntegrationProvider::Kodi => {
                self.process_progress(IntegrationType::Kodi(payload.clone()))
                    .await
            }
            IntegrationProvider::Emby => {
                self.process_progress(IntegrationType::Emby(payload.clone()))
                    .await
            }
            IntegrationProvider::Jellyfin => {
                self.process_progress(IntegrationType::Jellyfin(payload.clone()))
                    .await
            }
            IntegrationProvider::Plex => {
                let specifics = integration.clone().provider_specifics.unwrap();
                self.process_progress(IntegrationType::Plex(
                    payload.clone(),
                    specifics.plex_username,
                ))
                .await
            }
            _ => return Err(Error::new("Unsupported integration source".to_owned())),
        };
        match maybe_progress_update {
            Ok(pu) => {
                let media_vec = pu.0;
                for media in media_vec {
                    self.integration_progress_update(
                        &integration,
                        media.clone(),
                        &integration.user_id,
                    )
                    .await?;
                }
                let mut to_update: integration::ActiveModel = integration.into();
                to_update.last_triggered_on = ActiveValue::Set(Some(Utc::now()));
                to_update.update(&self.db).await?;
                Ok("Progress updated successfully".to_owned())
            }
            Err(e) => Err(Error::new(e.to_string())),
        }
    }

    async fn integration_progress_update(
        &self,
        integration: &integration::Model,
        pu: IntegrationMediaSeen,
        user_id: &String,
    ) -> GqlResult<()> {
        if pu.progress < integration.minimum_progress.unwrap() {
            return Ok(());
        }
        let progress = if pu.progress > integration.maximum_progress.unwrap() {
            dec!(100)
        } else {
            pu.progress
        };
        let metadata::Model { id, .. } = self
            .commit_metadata(CommitMediaInput {
                lot: pu.lot,
                source: pu.source,
                identifier: pu.identifier,
                force_update: None,
            })
            .await?;
        if let Err(err) = self
            .progress_update(
                ProgressUpdateInput {
                    metadata_id: id,
                    progress: Some(progress),
                    date: Some(get_current_date(&self.timezone)),
                    show_season_number: pu.show_season_number,
                    show_episode_number: pu.show_episode_number,
                    podcast_episode_number: pu.podcast_episode_number,
                    anime_episode_number: pu.anime_episode_number,
                    manga_chapter_number: pu.manga_chapter_number,
                    manga_volume_number: pu.manga_volume_number,
                    provider_watched_on: pu.provider_watched_on,
                    change_state: None,
                },
                user_id,
                true,
            )
            .await
        {
            ryot_log!(debug, "Error updating progress: {:?}", err);
        };
        Ok(())
    }

    async fn yank_integrations_data_for_user(&self, user_id: &String) -> GqlResult<bool> {
        let preferences = user_preferences_by_id(&self.db, user_id, &self.config).await?;
        if preferences.general.disable_integrations {
            return Ok(false);
        }
        let integrations = Integration::find()
            .filter(integration::Column::UserId.eq(user_id))
            .all(&self.db)
            .await?;
        let mut progress_updates = vec![];
        let mut collection_updates = vec![];
        let mut to_update_integrations = vec![];
        for integration in integrations.into_iter() {
            if integration.is_disabled.unwrap_or_default() {
                ryot_log!(debug, "Integration {} is disabled", integration.id);
                continue;
            }
            let response = match integration.provider {
                IntegrationProvider::Audiobookshelf => {
                    let specifics = integration.clone().provider_specifics.unwrap();
                    self.process_progress_commit(
                        IntegrationType::Audiobookshelf(
                            specifics.audiobookshelf_base_url.unwrap(),
                            specifics.audiobookshelf_token.unwrap(),
                            GoogleBooksService::new(
                                &self.config.books.google_books,
                                self.config.frontend.page_size,
                            )
                            .await,
                        ),
                        |input| self.commit_metadata(input),
                    )
                    .await
                }
                IntegrationProvider::Komga => {
                    let specifics = integration.clone().provider_specifics.unwrap();
                    self.process_progress(IntegrationType::Komga(
                        specifics.komga_base_url.unwrap(),
                        specifics.komga_username.unwrap(),
                        specifics.komga_password.unwrap(),
                        specifics.komga_provider.unwrap(),
                    ))
                    .await
                }
                _ => continue,
            };
            if let Ok((seen_progress, collection_progress)) = response {
                collection_updates.extend(collection_progress);
                to_update_integrations.push(integration.id.clone());
                progress_updates.push((integration, seen_progress));
            }
        }
        for (integration, progress_updates) in progress_updates.into_iter() {
            for pu in progress_updates.into_iter() {
                self.integration_progress_update(&integration, pu, user_id)
                    .await
                    .trace_ok();
            }
        }
        for col_update in collection_updates.into_iter() {
            let metadata_result = self
                .commit_metadata(CommitMediaInput {
                    lot: col_update.lot,
                    source: col_update.source,
                    identifier: col_update.identifier.clone(),
                    force_update: None,
                })
                .await;
            if let Ok(metadata::Model { id, .. }) = metadata_result {
                add_entity_to_collection(
                    &self.db,
                    user_id,
                    ChangeCollectionToEntityInput {
                        creator_user_id: user_id.to_owned(),
                        collection_name: col_update.collection,
                        entity_id: id.clone(),
                        entity_lot: EntityLot::Metadata,
                        ..Default::default()
                    },
                    &self.perform_core_application_job,
                )
                .await
                .trace_ok();
            }
        }
        Integration::update_many()
            .filter(integration::Column::Id.is_in(to_update_integrations))
            .col_expr(
                integration::Column::LastTriggeredOn,
                Expr::value(Utc::now()),
            )
            .exec(&self.db)
            .await?;
        Ok(true)
    }

    pub async fn yank_integrations_data(&self) -> GqlResult<()> {
        let users_with_integrations = Integration::find()
            .filter(integration::Column::Lot.eq(IntegrationLot::Yank))
            .select_only()
            .column(integration::Column::UserId)
            .into_tuple::<String>()
            .all(&self.db)
            .await?;
        for user_id in users_with_integrations {
            ryot_log!(debug, "Yanking integrations data for user {}", user_id);
            self.yank_integrations_data_for_user(&user_id).await?;
        }
        Ok(())
    }
}
