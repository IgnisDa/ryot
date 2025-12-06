use anyhow::Result;
use background_models::{ApplicationJob, MpApplicationJob};
use common_utils::ryot_log;
use database_models::{import_report, prelude::ImportReport};
use media_models::DeployImportJobInput;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use std::sync::Arc;
use supporting_service::SupportingService;

pub async fn deploy_import_job(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: DeployImportJobInput,
) -> Result<bool> {
    let job = MpApplicationJob::ImportFromExternalSource(user_id, Box::new(input));
    ss.perform_application_job(ApplicationJob::Mp(job)).await?;
    ryot_log!(debug, "Deployed import job");
    Ok(true)
}

pub async fn user_import_reports(
    ss: &Arc<SupportingService>,
    user_id: String,
) -> Result<Vec<import_report::Model>> {
    let reports = ImportReport::find()
        .filter(import_report::Column::UserId.eq(user_id))
        .order_by_desc(import_report::Column::StartedOn)
        .all(&ss.db)
        .await?;
    Ok(reports)
}
