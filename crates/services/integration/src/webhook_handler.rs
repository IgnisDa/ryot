use async_graphql::{Error, Result};
use chrono::Utc;
use common_utils::ryot_log;
use database_models::{integration, prelude::Integration};
use database_utils::user_by_id;
use dependent_models::{ImportCompletedItem, ImportResult};
use dependent_utils::process_import;
use enum_models::IntegrationProvider;
use rust_decimal_macros::dec;
use sea_orm::EntityTrait;

use traits::TraceOk;

use crate::integration_management::IntegrationManager;
use crate::{IntegrationService, sink};

impl IntegrationService {
    pub async fn integration_progress_update(
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
        IntegrationManager::set_trigger_result(
            &self.0,
            result.err().map(|e| e.message),
            &integration,
        )
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
                IntegrationManager::set_trigger_result(&self.0, Some(e.to_string()), &integration)
                    .await?;
                Err(Error::new(e.to_string()))
            }
        }
    }
}
