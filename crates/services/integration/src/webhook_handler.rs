use std::sync::Arc;

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
use supporting_service::SupportingService;
use traits::TraceOk;
use uuid::Uuid;

use crate::{integration_operations::set_trigger_result, sink};

// TEMP(1611): debug instrumentation for duplicate seen records; remove after investigation completes
fn log_import_result_details(import_result: &ImportResult, context: &str, tag: &str) {
    ryot_log!(
        debug,
        "{} {} with {} completed items",
        tag,
        context,
        import_result.completed.len()
    );
    for (idx, item) in import_result.completed.iter().enumerate() {
        if let ImportCompletedItem::Metadata(m) = item {
            ryot_log!(
                debug,
                "{} {} item {}: identifier={}, seen_history.len={}",
                tag,
                context,
                idx,
                m.identifier,
                m.seen_history.len()
            );
        }
    }
}

pub async fn integration_progress_update(
    ss: &Arc<SupportingService>,
    integration: integration::Model,
    updates: ImportResult,
) -> Result<()> {
    let progress_update_id = Uuid::new_v4();
    let progress_tag = format!("[1611 PROGRESS {}]", progress_update_id);
    ryot_log!(
        debug,
        "[1611 PROGRESS {}] Starting integration_progress_update for integration: {}, user: {}",
        progress_update_id,
        integration.id,
        integration.user_id
    );
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
    log_import_result_details(&import, "Calling process_import", &progress_tag);
    ryot_log!(
        debug,
        "[1611 PROGRESS {}] Calling process_import with {} completed items",
        progress_update_id,
        import.completed.len()
    );
    let result = process_import(false, &integration.user_id, import, ss, |_| async {
        Ok(())
    })
    .await;
    ryot_log!(
        debug,
        "[1611 PROGRESS {}] process_import completed, result: {}",
        progress_update_id,
        if result.is_ok() { "success" } else { "error" }
    );
    set_trigger_result(ss, result.err().map(|e| e.to_string()), &integration).await?;
    ryot_log!(
        debug,
        "[1611 PROGRESS {}] Completed integration_progress_update",
        progress_update_id
    );
    Ok(())
}

pub async fn process_integration_webhook(
    ss: &Arc<SupportingService>,
    integration_slug: String,
    payload: String,
) -> Result<String> {
    let webhook_job_id = Uuid::new_v4();
    let job_tag = format!("[1611 JOB {}]", webhook_job_id);
    ryot_log!(
        debug,
        "[1611 JOB {}] Processing webhook for integration: {}, payload len: {}",
        webhook_job_id,
        integration_slug,
        payload.len()
    );
    ryot_log!(debug, "Integration webhook for slug: {}", integration_slug);
    let integration = Integration::find_by_id(&integration_slug)
        .one(&ss.db)
        .await?
        .ok_or(anyhow!("Integration does not exist"))?;
    let preferences = user_by_id(&integration.user_id, ss).await?.preferences;
    if integration.is_disabled.unwrap_or_default() || preferences.general.disable_integrations {
        ryot_log!(
            debug,
            "[1611 JOB {}] Integration disabled for slug: {}, user: {}",
            webhook_job_id,
            integration_slug,
            integration.user_id
        );
        bail!("Integration is disabled");
    }
    let maybe_progress_update = match integration.provider {
        IntegrationProvider::Kodi => sink::kodi::sink_progress(payload).await,
        IntegrationProvider::Emby => sink::emby::sink_progress(payload, ss).await,
        IntegrationProvider::GenericJson => sink::generic_json::sink_progress(payload).await,
        IntegrationProvider::JellyfinSink => {
            let specifics = integration.clone().provider_specifics.unwrap();
            sink::jellyfin::sink_progress(payload, specifics.jellyfin_sink_username).await
        }
        IntegrationProvider::PlexSink => {
            let specifics = integration.clone().provider_specifics.unwrap();
            sink::plex::sink_progress(payload, specifics.plex_sink_username, ss).await
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
        Ok(None) => {
            ryot_log!(
                debug,
                "[1611 JOB {}] No progress update for integration: {}",
                webhook_job_id,
                integration_slug
            );
            Ok("No progress update".to_owned())
        }
        Ok(Some(pu)) => {
            log_import_result_details(&pu, "Webhook received ImportResult", &job_tag);
            ryot_log!(
                debug,
                "[1611 JOB {}] Calling integration_progress_update",
                webhook_job_id
            );
            integration_progress_update(ss, integration, pu)
                .await
                .trace_ok();
            ryot_log!(
                debug,
                "[1611 JOB {}] Completed webhook processing successfully",
                webhook_job_id
            );
            Ok("Progress updated successfully".to_owned())
        }
        Err(e) => {
            ryot_log!(
                debug,
                "[1611 JOB {}] Webhook processing failed: {}",
                webhook_job_id,
                e
            );
            set_trigger_result(ss, Some(e.to_string()), &integration).await?;
            Err(anyhow!(e.to_string()))
        }
    }
}
