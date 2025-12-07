use std::sync::Arc;

use anyhow::Result;
use background_models::{ApplicationJob, HpApplicationJob};
use database_models::{prelude::User, user};
use database_utils::admin_account_guard;
pub use dependent_jobs_utils::deploy_update_media_entity_job;
use dependent_models::{ApplicationCacheKey, ApplicationCacheValue, EmptyCacheValue};
use media_models::MetadataProgressUpdateInput;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, prelude::DateTimeUtc, prelude::Expr};
use supporting_service::SupportingService;
use uuid::Uuid;

pub async fn deploy_bulk_metadata_progress_update(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: Vec<MetadataProgressUpdateInput>,
) -> Result<bool> {
    ss.perform_application_job(ApplicationJob::Hp(
        HpApplicationJob::BulkMetadataProgressUpdate(user_id, input),
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

pub async fn update_user_last_activity_performed(
    ss: &Arc<SupportingService>,
    user_id: String,
    timestamp: DateTimeUtc,
) -> Result<()> {
    User::update_many()
        .filter(user::Column::Id.eq(user_id))
        .col_expr(user::Column::LastActivityOn, Expr::value(timestamp))
        .exec(&ss.db)
        .await?;
    Ok(())
}

#[cfg(debug_assertions)]
pub async fn development_mutation(_ss: &Arc<SupportingService>) -> Result<bool> {
    Ok(true)
}
