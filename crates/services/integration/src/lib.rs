use std::{
    collections::{HashSet, VecDeque},
    sync::Arc,
};

use async_graphql::{Error, Result};
use chrono::Utc;
use common_utils::ryot_log;
use database_models::{
    integration, metadata,
    prelude::{CollectionToEntity, Integration, Metadata, Seen, UserToEntity},
    seen, user_to_entity,
};
use database_utils::{server_key_validation_guard, user_by_id};
use dependent_models::{ImportCompletedItem, ImportResult};
use dependent_utils::{
    get_google_books_service, get_hardcover_service, get_openlibrary_service, process_import,
    send_notification_for_user,
};
use enum_models::{
    EntityLot, IntegrationLot, IntegrationProvider, MediaLot, UserNotificationContent,
};
use media_models::{IntegrationTriggerResult, SeenShowExtraInformation};
use rust_decimal_macros::dec;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
    QueryTrait,
};
use supporting_service::SupportingService;
use traits::TraceOk;
use uuid::Uuid;

mod push;
mod sink;
mod utils;
mod yank;

pub struct IntegrationService(pub Arc<SupportingService>);

impl IntegrationService {
    async fn set_trigger_result(
        &self,
        error: Option<String>,
        integration: &integration::Model,
    ) -> Result<()> {
        let finished_at = Utc::now();
        let last_finished_at = match error {
            Some(_) => ActiveValue::NotSet,
            None => ActiveValue::Set(Some(finished_at)),
        };
        let mut new_trigger_result = VecDeque::from(integration.trigger_result.clone());
        if new_trigger_result.len() >= 20 {
            new_trigger_result.pop_back();
        }
        new_trigger_result.push_front(IntegrationTriggerResult { error, finished_at });
        let are_all_errors = new_trigger_result.iter().take(5).all(|r| r.error.is_some());

        let should_disable =
            integration.extra_settings.disable_on_continuous_errors && are_all_errors;

        let mut integration: integration::ActiveModel = integration.clone().into();
        integration.last_finished_at = last_finished_at;
        integration.trigger_result = ActiveValue::Set(new_trigger_result.into());

        if should_disable {
            integration.is_disabled = ActiveValue::Set(Some(true));
        }

        let integration = integration.update(&self.0.db).await?;

        if should_disable {
            send_notification_for_user(
                &integration.user_id,
                &self.0,
                &(
                    format!(
                        "Integration {} has been disabled due to too many errors",
                        integration.provider,
                    ),
                    UserNotificationContent::IntegrationDisabledDueToTooManyErrors,
                ),
            )
            .await
            .trace_ok();
        }
        Ok(())
    }

    async fn select_integrations_to_process(
        &self,
        user_id: &String,
        lot: IntegrationLot,
        provider: Option<IntegrationProvider>,
    ) -> Result<Vec<integration::Model>> {
        let integrations = Integration::find()
            .filter(integration::Column::Lot.eq(lot))
            .filter(integration::Column::UserId.eq(user_id))
            .filter(
                integration::Column::IsDisabled
                    .is_null()
                    .or(integration::Column::IsDisabled.eq(false)),
            )
            .apply_if(provider, |query, provider| {
                query.filter(integration::Column::Provider.eq(provider))
            })
            .order_by_asc(integration::Column::CreatedOn)
            .all(&self.0.db)
            .await?;
        Ok(integrations)
    }

    async fn integration_progress_update(
        &self,
        integration: integration::Model,
        updates: ImportResult,
    ) -> Result<()> {
        let mut import = updates;
        import.completed.iter_mut().for_each(|item| {
            if let ImportCompletedItem::Metadata(metadata) = item {
                metadata
                    .seen_history
                    .retain(|update| match update.progress {
                        Some(progress) if progress < integration.minimum_progress.unwrap() => {
                            ryot_log!(
                                debug,
                                "Progress update for integration {} is below minimum threshold",
                                integration.id
                            );
                            false
                        }
                        _ => true,
                    });
                metadata.seen_history.iter_mut().for_each(|update| {
                    update.ended_on = Some(update.ended_on.unwrap_or(Utc::now().date_naive()));
                    if let Some(progress) = update.progress {
                        if progress > integration.maximum_progress.unwrap() {
                            ryot_log!(
                                debug,
                                "Changing progress to 100 for integration {}",
                                integration.id
                            );
                            update.progress = Some(dec!(100));
                        }
                    }
                });
            }
        });
        let result = process_import(&integration.user_id, true, import, &self.0, |_| async {
            Ok(())
        })
        .await;
        self.set_trigger_result(result.err().map(|e| e.message), &integration)
            .await?;
        Ok(())
    }

    pub async fn process_integration_webhook(
        &self,
        integration_slug: String,
        payload: String,
    ) -> Result<String> {
        ryot_log!(
            debug,
            "Processing integration webhook for slug: {}",
            integration_slug
        );
        let integration = Integration::find_by_id(integration_slug)
            .one(&self.0.db)
            .await?
            .ok_or_else(|| Error::new("Integration does not exist".to_owned()))?;
        let preferences = user_by_id(&integration.user_id, &self.0).await?.preferences;
        if integration.is_disabled.unwrap_or_default() || preferences.general.disable_integrations {
            return Err(Error::new("Integration is disabled".to_owned()));
        }
        let maybe_progress_update = match integration.provider {
            IntegrationProvider::Kodi => sink::kodi::sink_progress(payload).await,
            IntegrationProvider::Emby => sink::emby::sink_progress(payload, &self.0.db).await,
            IntegrationProvider::JellyfinSink => sink::jellyfin::sink_progress(payload).await,
            IntegrationProvider::PlexSink => {
                let specifics = integration.clone().provider_specifics.unwrap();
                sink::plex::sink_progress(payload, &self.0.db, specifics.plex_sink_username).await
            }
            IntegrationProvider::GenericJson => sink::generic_json::sink_progress(payload).await,
            _ => return Err(Error::new("Unsupported integration source".to_owned())),
        };
        match maybe_progress_update {
            Ok(None) => Ok("No progress update".to_owned()),
            Ok(Some(pu)) => {
                self.integration_progress_update(integration, pu)
                    .await
                    .trace_ok();
                Ok("Progress updated successfully".to_owned())
            }
            Err(e) => {
                self.set_trigger_result(Some(e.to_string()), &integration)
                    .await?;
                Err(Error::new(e.to_string()))
            }
        }
    }

    pub async fn handle_entity_added_to_collection_event(
        &self,
        collection_to_entity_id: Uuid,
    ) -> Result<()> {
        let cte = CollectionToEntity::find_by_id(collection_to_entity_id)
            .one(&self.0.db)
            .await?
            .ok_or_else(|| Error::new("Collection to entity does not exist"))?;
        if !matches!(cte.entity_lot, EntityLot::Metadata) {
            return Ok(());
        }
        let users = UserToEntity::find()
            .select_only()
            .column(user_to_entity::Column::UserId)
            .filter(user_to_entity::Column::CollectionId.eq(&cte.collection_id))
            .into_tuple::<String>()
            .all(&self.0.db)
            .await?;
        for user_id in users {
            let integrations = self
                .select_integrations_to_process(&user_id, IntegrationLot::Push, None)
                .await?;
            for integration in integrations {
                let possible_collection_ids = match integration.provider_specifics.clone() {
                    Some(s) => match integration.provider {
                        IntegrationProvider::Radarr => {
                            s.radarr_sync_collection_ids.unwrap_or_default()
                        }
                        IntegrationProvider::Sonarr => {
                            s.sonarr_sync_collection_ids.unwrap_or_default()
                        }
                        _ => vec![],
                    },
                    None => vec![],
                };
                if !possible_collection_ids.contains(&cte.collection_id) {
                    continue;
                }
                let specifics = integration.provider_specifics.clone().unwrap();
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
                let Some(entity_id) = maybe_entity_id else {
                    continue;
                };
                let push_result = match integration.provider {
                    IntegrationProvider::Radarr => {
                        push::radarr::push_progress(
                            specifics.radarr_api_key.unwrap(),
                            specifics.radarr_profile_id.unwrap(),
                            entity_id,
                            specifics.radarr_base_url.unwrap(),
                            metadata.lot,
                            metadata.title,
                            specifics.radarr_root_folder_path.unwrap(),
                        )
                        .await
                    }
                    IntegrationProvider::Sonarr => {
                        push::sonarr::push_progress(
                            specifics.sonarr_api_key.unwrap(),
                            specifics.sonarr_profile_id.unwrap(),
                            entity_id,
                            specifics.sonarr_base_url.unwrap(),
                            metadata.lot,
                            metadata.title,
                            specifics.sonarr_root_folder_path.unwrap(),
                        )
                        .await
                    }
                    _ => unreachable!(),
                };
                self.set_trigger_result(push_result.err().map(|e| e.to_string()), &integration)
                    .await?;
            }
        }
        Ok(())
    }

    pub async fn handle_on_seen_complete(&self, id: String) -> Result<()> {
        let (seen, show_extra_information, metadata_title, metadata_lot) = Seen::find_by_id(id)
            .left_join(Metadata)
            .select_only()
            .columns([seen::Column::UserId, seen::Column::ShowExtraInformation])
            .columns([metadata::Column::Title, metadata::Column::Lot])
            .into_tuple::<(String, Option<SeenShowExtraInformation>, String, MediaLot)>()
            .one(&self.0.db)
            .await?
            .ok_or_else(|| Error::new("Seen with the given ID could not be found"))?;
        let integrations = self
            .select_integrations_to_process(
                &seen,
                IntegrationLot::Push,
                Some(IntegrationProvider::JellyfinPush),
            )
            .await?;
        for integration in integrations {
            let specifics = integration.provider_specifics.clone().unwrap();
            let push_result = match integration.provider {
                IntegrationProvider::JellyfinPush => {
                    server_key_validation_guard(self.0.is_server_key_validated().await?).await?;
                    push::jellyfin::push_progress(
                        specifics.jellyfin_push_base_url.unwrap(),
                        specifics.jellyfin_push_username.unwrap(),
                        specifics.jellyfin_push_password.unwrap(),
                        &metadata_lot,
                        &metadata_title,
                        &show_extra_information,
                    )
                    .await
                }
                _ => unreachable!(),
            };
            self.set_trigger_result(push_result.err().map(|e| e.to_string()), &integration)
                .await?;
        }
        Ok(())
    }

    async fn yank_integrations_data_for_user(&self, user_id: &String) -> Result<()> {
        let preferences = user_by_id(user_id, &self.0).await?.preferences;
        if preferences.general.disable_integrations {
            return Ok(());
        }
        let integrations = self
            .select_integrations_to_process(user_id, IntegrationLot::Yank, None)
            .await?;
        let mut progress_updates = vec![];
        for integration in integrations.into_iter() {
            let specifics = integration.clone().provider_specifics.unwrap();
            let response = match integration.provider {
                IntegrationProvider::Audiobookshelf => {
                    yank::audiobookshelf::yank_progress(
                        specifics.audiobookshelf_base_url.unwrap(),
                        specifics.audiobookshelf_token.unwrap(),
                        &self.0,
                        &get_hardcover_service(&self.0.config).await.unwrap(),
                        &get_google_books_service(&self.0.config).await.unwrap(),
                        &get_openlibrary_service(&self.0.config).await.unwrap(),
                    )
                    .await
                }
                IntegrationProvider::Komga => {
                    yank::komga::yank_progress(
                        specifics.komga_base_url.unwrap(),
                        specifics.komga_username.unwrap(),
                        specifics.komga_password.unwrap(),
                        specifics.komga_provider.unwrap(),
                        &self.0.db,
                    )
                    .await
                }
                IntegrationProvider::YoutubeMusic => {
                    server_key_validation_guard(self.0.is_server_key_validated().await?).await?;
                    yank::youtube_music::yank_progress(
                        user_id,
                        specifics.youtube_music_timezone.unwrap(),
                        specifics.youtube_music_auth_cookie.unwrap(),
                        &self.0,
                    )
                    .await
                }
                _ => continue,
            };
            match response {
                Ok(update) => progress_updates.push((integration, update)),
                Err(e) => {
                    self.set_trigger_result(Some(e.to_string()), &integration)
                        .await?;
                }
            };
        }
        for (integration, progress_updates) in progress_updates.into_iter() {
            self.integration_progress_update(integration, progress_updates)
                .await
                .trace_ok();
        }
        Ok(())
    }

    pub async fn yank_integrations_data(&self) -> Result<()> {
        let users_with_integrations = Integration::find()
            .filter(integration::Column::Lot.eq(IntegrationLot::Yank))
            .select_only()
            .column(integration::Column::UserId)
            .into_tuple::<String>()
            .all(&self.0.db)
            .await?
            .into_iter()
            .collect::<HashSet<String>>();
        for user_id in users_with_integrations {
            ryot_log!(debug, "Yanking integrations data for user {}", user_id);
            self.yank_integrations_data_for_user(&user_id).await?;
        }
        Ok(())
    }

    async fn sync_integrations_data_to_owned_collection_for_user(
        &self,
        user_id: &String,
    ) -> Result<bool> {
        let preferences = user_by_id(user_id, &self.0).await?.preferences;
        if preferences.general.disable_integrations {
            return Ok(false);
        }
        let integrations = self
            .select_integrations_to_process(user_id, IntegrationLot::Yank, None)
            .await?;
        let mut progress_updates = vec![];
        for integration in integrations.into_iter() {
            if !integration.sync_to_owned_collection.unwrap_or_default() {
                continue;
            }
            let specifics = integration.clone().provider_specifics.unwrap();
            let response = match integration.provider {
                IntegrationProvider::Audiobookshelf => {
                    yank::audiobookshelf::sync_to_owned_collection(
                        specifics.audiobookshelf_base_url.unwrap(),
                        &get_hardcover_service(&self.0.config).await.unwrap(),
                        &get_google_books_service(&self.0.config).await.unwrap(),
                        &get_openlibrary_service(&self.0.config).await.unwrap(),
                    )
                    .await
                }
                IntegrationProvider::Komga => {
                    yank::komga::sync_to_owned_collection(
                        specifics.komga_base_url.unwrap(),
                        specifics.komga_username.unwrap(),
                        specifics.komga_password.unwrap(),
                        specifics.komga_provider.unwrap(),
                        &self.0.db,
                    )
                    .await
                }
                IntegrationProvider::PlexYank => {
                    yank::plex::sync_to_owned_collection(
                        specifics.plex_yank_base_url.unwrap(),
                        specifics.plex_yank_token.unwrap(),
                    )
                    .await
                }
                _ => continue,
            };
            match response {
                Ok(update) => progress_updates.push((integration, update)),
                Err(e) => {
                    self.set_trigger_result(Some(e.to_string()), &integration)
                        .await?;
                }
            };
        }
        for (integration, progress_updates) in progress_updates.into_iter() {
            self.integration_progress_update(integration, progress_updates)
                .await
                .trace_ok();
        }
        Ok(true)
    }

    async fn sync_integrations_data_to_owned_collection(&self) -> Result<()> {
        let users_with_integrations = Integration::find()
            .filter(integration::Column::SyncToOwnedCollection.eq(true))
            .select_only()
            .column(integration::Column::UserId)
            .into_tuple::<String>()
            .all(&self.0.db)
            .await?
            .into_iter()
            .collect::<HashSet<String>>();
        for user_id in users_with_integrations {
            ryot_log!(
                debug,
                "Syncing integrations data to owned collection for user {}",
                user_id
            );
            self.sync_integrations_data_to_owned_collection_for_user(&user_id)
                .await?;
        }
        Ok(())
    }

    pub async fn sync_integrations_data_for_user(&self, user_id: &String) -> Result<()> {
        self.sync_integrations_data_to_owned_collection_for_user(user_id)
            .await?;
        self.yank_integrations_data_for_user(user_id).await?;
        Ok(())
    }

    pub async fn sync_integrations_data(&self) -> Result<()> {
        self.yank_integrations_data().await?;
        self.sync_integrations_data_to_owned_collection().await?;
        Ok(())
    }
}
