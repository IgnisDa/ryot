use anyhow::{Result, anyhow, bail};
use chrono::Utc;
use common_utils::ryot_log;
use database_models::{integration, prelude::Integration};
use database_utils::user_by_id;
use dependent_import_utils::process_import;
use dependent_models::{ImportCompletedItem, ImportResult};
use enum_models::IntegrationProvider;
use rust_decimal::dec;
use sea_orm::EntityTrait;
use traits::TraceOk;

use crate::{IntegrationService, integration_operations::set_trigger_result, sink};

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
                            ryot_log!(debug, "Update {} below minimum threshold", integration.id);
                            false
                        }
                        _ => true,
                    });
                metadata.seen_history.iter_mut().for_each(|update| {
                    update.ended_on = Some(update.ended_on.unwrap_or(Utc::now()));
                    if let Some(progress) = update.progress
                        && progress > integration.maximum_progress.unwrap()
                    {
                        ryot_log!(debug, "Changing progress to 100 for {}", integration.id);
                        update.progress = Some(dec!(100));
                    }
                });
            }
        });
        ryot_log!(
            debug,
            "Calling process_import with {} completed items after filtering",
            import.completed.len()
        );
        for (idx, item) in import.completed.iter().enumerate() {
            if let ImportCompletedItem::Metadata(m) = item {
                ryot_log!(
                    debug,
                    "process_import input item {}: identifier={}, seen_history.len={}",
                    idx,
                    m.identifier,
                    m.seen_history.len()
                );
            }
        }
        let result = process_import(false, &integration.user_id, import, &self.0, |_| async {
            Ok(())
        })
        .await;
        set_trigger_result(&self.0, result.err().map(|e| e.to_string()), &integration).await?;
        Ok(())
    }

    pub async fn process_integration_webhook(
        &self,
        integration_slug: String,
        payload: String,
    ) -> Result<String> {
        ryot_log!(debug, "Integration webhook for slug: {}", integration_slug);
        let integration = Integration::find_by_id(integration_slug)
            .one(&self.0.db)
            .await?
            .ok_or(anyhow!("Integration does not exist"))?;
        let preferences = user_by_id(&integration.user_id, &self.0).await?.preferences;
        if integration.is_disabled.unwrap_or_default() || preferences.general.disable_integrations {
            bail!("Integration is disabled");
        }
        let maybe_progress_update = match integration.provider {
            IntegrationProvider::Kodi => sink::kodi::sink_progress(payload).await,
            IntegrationProvider::Emby => sink::emby::sink_progress(payload, &self.0).await,
            IntegrationProvider::JellyfinSink => sink::jellyfin::sink_progress(payload).await,
            IntegrationProvider::GenericJson => sink::generic_json::sink_progress(payload).await,
            IntegrationProvider::PlexSink => {
                let specifics = integration.clone().provider_specifics.unwrap();
                sink::plex::sink_progress(payload, specifics.plex_sink_username, &self.0).await
            }
            IntegrationProvider::RyotBrowserExtension => {
                let specifics = integration.clone().provider_specifics.unwrap();
                sink::ryot_browser_extension::sink_progress(
                    payload,
                    specifics.ryot_browser_extension_disabled_sites,
                )
                .await
            }
            _ => bail!("Unsupported integration source"),
        };
        match maybe_progress_update {
            Ok(None) => Ok("No progress update".to_owned()),
            Ok(Some(pu)) => {
                ryot_log!(
                    debug,
                    "Webhook received ImportResult with {} completed items",
                    pu.completed.len()
                );
                for (idx, item) in pu.completed.iter().enumerate() {
                    if let ImportCompletedItem::Metadata(m) = item {
                        ryot_log!(
                            debug,
                            "Webhook ImportResult item {}: identifier={}, seen_history.len={}",
                            idx,
                            m.identifier,
                            m.seen_history.len()
                        );
                    }
                }
                self.integration_progress_update(integration, pu)
                    .await
                    .trace_ok();
                Ok("Progress updated successfully".to_owned())
            }
            Err(e) => {
                set_trigger_result(&self.0, Some(e.to_string()), &integration).await?;
                Err(anyhow!(e.to_string()))
            }
        }
    }
}
