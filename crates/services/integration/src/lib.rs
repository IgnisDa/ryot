use std::{future::Future, sync::Arc};

use anyhow::{bail, Result};
use async_graphql::{Error, Result as GqlResult};
use chrono::Utc;
use common_utils::ryot_log;
use database_models::{integration, prelude::Integration};
use database_models::{
    metadata,
    prelude::{CollectionToEntity, Metadata},
};
use database_utils::user_preferences_by_id;
use dependent_models::ImportResult;
use dependent_utils::{commit_metadata, process_import};
use enums::MediaSource;
use enums::{EntityLot, IntegrationLot, IntegrationProvider, MediaLot};
use media_models::CommitMediaInput;
use providers::google_books::GoogleBooksService;
use rust_decimal_macros::dec;
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter, QuerySelect};
use supporting_service::SupportingService;
use traits::TraceOk;
use uuid::Uuid;

mod push;
mod sink;
mod traita;
mod yank;

use crate::{
    push::{radarr::RadarrIntegration, sonarr::SonarrIntegration},
    sink::{
        emby::EmbyIntegration, jellyfin::JellyfinIntegration, kodi::KodiIntegration,
        plex::PlexIntegration,
    },
    traita::PushIntegration,
    traita::YankIntegration,
    traita::YankIntegrationWithCommit,
    yank::{audiobookshelf::AudiobookshelfIntegration, komga::KomgaIntegration},
};

pub enum IntegrationType {
    Komga(String, String, String, MediaSource, Option<bool>),
    Jellyfin(String),
    Emby(String),
    Plex(String, Option<String>),
    Audiobookshelf(String, String, Option<bool>, GoogleBooksService),
    Kodi(String),
    Sonarr(String, String, i32, String, String),
    Radarr(String, String, i32, String, String),
}

pub struct IntegrationService(pub Arc<SupportingService>);

impl IntegrationService {
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
            _ => bail!("Unsupported integration type"),
        }
    }

    async fn process_progress(&self, integration_type: IntegrationType) -> Result<ImportResult> {
        match integration_type {
            IntegrationType::Jellyfin(payload) => {
                let jellyfin = JellyfinIntegration::new(payload);
                jellyfin.yank_progress().await
            }
            IntegrationType::Emby(payload) => {
                let emby = EmbyIntegration::new(payload, self.0.db.clone());
                emby.yank_progress().await
            }
            IntegrationType::Plex(payload, plex_user) => {
                let plex = PlexIntegration::new(payload, plex_user, self.0.db.clone());
                plex.yank_progress().await
            }
            IntegrationType::Kodi(payload) => {
                let kodi = KodiIntegration::new(payload);
                kodi.yank_progress().await
            }
            _ => bail!("Unsupported integration type"),
        }
    }

    async fn process_progress_commit<F>(
        &self,
        integration_type: IntegrationType,
        commit_metadata: impl Fn(CommitMediaInput) -> F,
    ) -> Result<ImportResult>
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
                    self.0.db.clone(),
                    sync_to_owned_collection,
                );
                komga.yank_progress().await
            }
            _ => bail!("Unsupported integration type"),
        }
    }

    async fn integration_progress_update(
        &self,
        integration: integration::Model,
        updates: ImportResult,
    ) -> GqlResult<()> {
        let mut updates = updates;
        for media in updates.media.iter_mut() {
            let mut history = vec![];
            for update in media.seen_history.iter_mut() {
                if let Some(progress) = update.progress {
                    if progress < integration.minimum_progress.unwrap() {
                        ryot_log!(
                            debug,
                            "Progress update for integration {} is below minimum threshold",
                            integration.id
                        );
                        continue;
                    }
                    if progress > integration.maximum_progress.unwrap() {
                        update.progress = Some(dec!(100));
                    }
                    history.push(update);
                }
            }
            media.seen_history = history.into_iter().map(|h| h.clone()).collect();
        }
        if let Err(err) = process_import(
            &integration.user_id,
            updates,
            &self.0.db,
            &self.0.timezone,
            &self.0.config,
            &self.0.cache_service,
            &self.0.commit_cache,
            &self.0.perform_application_job,
            &self.0.perform_core_application_job,
        )
        .await
        {
            ryot_log!(debug, "Error updating progress: {:?}", err);
        } else {
            let mut to_update: integration::ActiveModel = integration.into();
            to_update.last_triggered_on = ActiveValue::Set(Some(Utc::now()));
            to_update.update(&self.0.db).await?;
        }
        Ok(())
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
            .one(&self.0.db)
            .await?
            .ok_or_else(|| Error::new("Integration does not exist".to_owned()))?;
        let preferences =
            user_preferences_by_id(&self.0.db, &integration.user_id, &self.0.config).await?;
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
                self.integration_progress_update(integration, pu)
                    .await
                    .trace_ok();
                Ok("Progress updated successfully".to_owned())
            }
            Err(e) => Err(Error::new(e.to_string())),
        }
    }

    pub async fn handle_entity_added_to_collection_event(
        &self,
        user_id: String,
        collection_to_entity_id: Uuid,
    ) -> GqlResult<()> {
        let cte = CollectionToEntity::find_by_id(collection_to_entity_id)
            .one(&self.0.db)
            .await?
            .ok_or_else(|| Error::new("Collection to entity does not exist"))?;
        if !matches!(cte.entity_lot, EntityLot::Metadata) {
            return Ok(());
        }
        let integrations = Integration::find()
            .filter(integration::Column::UserId.eq(user_id))
            .filter(integration::Column::Lot.eq(IntegrationLot::Push))
            .all(&self.0.db)
            .await?;
        for integration in integrations {
            let possible_collection_ids = match integration.provider_specifics.clone() {
                Some(s) => match integration.provider {
                    IntegrationProvider::Radarr => s.radarr_sync_collection_ids.unwrap_or_default(),
                    IntegrationProvider::Sonarr => s.sonarr_sync_collection_ids.unwrap_or_default(),
                    _ => vec![],
                },
                None => vec![],
            };
            if !possible_collection_ids.contains(&cte.collection_id) {
                continue;
            }
            let specifics = integration.provider_specifics.unwrap();
            let metadata = Metadata::find_by_id(&cte.entity_id)
                .one(&self.0.db)
                .await?
                .ok_or_else(|| Error::new("Metadata does not exist"))?;
            let maybe_entity_id = match metadata.lot {
                MediaLot::Show => metadata
                    .external_identifiers
                    .and_then(|ei| ei.tvdb_id.map(|i| i.to_string())),
                _ => Some(metadata.identifier.clone()),
            };
            if let Some(entity_id) = maybe_entity_id {
                let _push_result = match integration.provider {
                    IntegrationProvider::Radarr => {
                        self.push(IntegrationType::Radarr(
                            specifics.radarr_base_url.unwrap(),
                            specifics.radarr_api_key.unwrap(),
                            specifics.radarr_profile_id.unwrap(),
                            specifics.radarr_root_folder_path.unwrap(),
                            entity_id,
                        ))
                        .await
                    }
                    IntegrationProvider::Sonarr => {
                        self.push(IntegrationType::Sonarr(
                            specifics.sonarr_base_url.unwrap(),
                            specifics.sonarr_api_key.unwrap(),
                            specifics.sonarr_profile_id.unwrap(),
                            specifics.sonarr_root_folder_path.unwrap(),
                            entity_id,
                        ))
                        .await
                    }
                    _ => unreachable!(),
                };
            }
        }
        Ok(())
    }

    pub async fn yank_integrations_data_for_user(&self, user_id: &String) -> GqlResult<bool> {
        let preferences = user_preferences_by_id(&self.0.db, user_id, &self.0.config).await?;
        if preferences.general.disable_integrations {
            return Ok(false);
        }
        let integrations = Integration::find()
            .filter(integration::Column::UserId.eq(user_id))
            .filter(integration::Column::Lot.eq(IntegrationLot::Yank))
            .all(&self.0.db)
            .await?;
        let mut progress_updates = vec![];
        let mut to_update_integrations = vec![];
        for integration in integrations.into_iter() {
            if integration.is_disabled.unwrap_or_default() {
                ryot_log!(debug, "Integration {} is disabled", integration.id);
                continue;
            }
            let specifics = integration.clone().provider_specifics.unwrap();
            let response = match integration.provider {
                IntegrationProvider::Audiobookshelf => {
                    self.process_progress_commit(
                        IntegrationType::Audiobookshelf(
                            specifics.audiobookshelf_base_url.unwrap(),
                            specifics.audiobookshelf_token.unwrap(),
                            integration.sync_to_owned_collection,
                            GoogleBooksService::new(
                                &self.0.config.books.google_books,
                                self.0.config.frontend.page_size,
                            )
                            .await,
                        ),
                        |input| {
                            commit_metadata(
                                input,
                                &self.0.db,
                                &self.0.timezone,
                                &self.0.config,
                                &self.0.commit_cache,
                                &self.0.perform_application_job,
                            )
                        },
                    )
                    .await
                }
                IntegrationProvider::Komga => {
                    self.process_progress(IntegrationType::Komga(
                        specifics.komga_base_url.unwrap(),
                        specifics.komga_username.unwrap(),
                        specifics.komga_password.unwrap(),
                        specifics.komga_provider.unwrap(),
                        integration.sync_to_owned_collection,
                    ))
                    .await
                }
                _ => continue,
            };
            if let Ok(update) = response {
                to_update_integrations.push(integration.id.clone());
                progress_updates.push((integration, update));
            }
        }
        for (integration, progress_updates) in progress_updates.into_iter() {
            self.integration_progress_update(integration, progress_updates)
                .await
                .trace_ok();
        }
        Ok(true)
    }

    pub async fn yank_integrations_data(&self) -> GqlResult<()> {
        let users_with_integrations = Integration::find()
            .filter(integration::Column::Lot.eq(IntegrationLot::Yank))
            .select_only()
            .column(integration::Column::UserId)
            .into_tuple::<String>()
            .all(&self.0.db)
            .await?;
        for user_id in users_with_integrations {
            ryot_log!(debug, "Yanking integrations data for user {}", user_id);
            self.yank_integrations_data_for_user(&user_id).await?;
        }
        Ok(())
    }
}
