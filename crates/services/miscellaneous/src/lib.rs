use std::sync::Arc;

use anyhow::Result;
use background_models::{ApplicationJob, SingleApplicationJob};
use database_utils::admin_account_guard;
pub use dependent_jobs_utils::deploy_update_media_entity_job;
use dependent_models::{ApplicationCacheKey, ApplicationCacheValue, EmptyCacheValue};
use media_models::MetadataProgressUpdateInput;
use supporting_service::SupportingService;
use uuid::Uuid;

#[tracing::instrument(skip(ss))]
pub async fn deploy_bulk_metadata_progress_update(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: Vec<MetadataProgressUpdateInput>,
) -> Result<bool> {
    ss.perform_application_job(ApplicationJob::Single(
        SingleApplicationJob::BulkMetadataProgressUpdate(user_id, input),
    ))
    .await?;
    Ok(true)
}

pub async fn generate_log_download_url(
    ss: &Arc<SupportingService>,
    user_id: &String,
) -> Result<String> {
    admin_account_guard(user_id, ss).await?;

    let token = Uuid::new_v4().to_string();
    let key = ApplicationCacheKey::LogDownloadToken(token.clone());
    let value = ApplicationCacheValue::LogDownloadToken(EmptyCacheValue::default());

    cache_service::set_key(ss, key, value).await?;

    let download_url = format!("{}/backend/logs/download/{}", ss.config.frontend.url, token);

    Ok(download_url)
}

#[cfg(debug_assertions)]
pub async fn development_mutation(_ss: &Arc<SupportingService>) -> Result<bool> {
    Ok(true)
}
