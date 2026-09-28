use std::sync::Arc;

use anyhow::{Result, anyhow};
use background_models::{ApplicationJob, SingleApplicationJob};
use chrono::Utc;
use common_utils::ryot_log;
use database_models::{import_report, prelude::ImportReport};
use media_models::DeployImportJobInput;
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use supporting_service::SupportingService;

pub async fn deploy_import_job(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: DeployImportJobInput,
) -> Result<bool> {
    let queued_at = Utc::now();
    let report = import_report::ActiveModel {
        progress: ActiveValue::Set(None),
        source: ActiveValue::Set(input.source),
        started_on: ActiveValue::Set(queued_at),
        user_id: ActiveValue::Set(user_id.clone()),
        estimated_finish_time: ActiveValue::Set(queued_at),
        ..Default::default()
    }
    .insert(&ss.db)
    .await?;
    let job = SingleApplicationJob::ImportFromExternalSource(user_id, report.id, Box::new(input));
    ss.perform_application_job(ApplicationJob::Single(job))
        .await?;
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

pub async fn delete_user_import_report(
    ss: &Arc<SupportingService>,
    user_id: String,
    import_report_id: String,
) -> Result<bool> {
    let report = ImportReport::find_by_id(import_report_id.clone())
        .one(&ss.db)
        .await?
        .ok_or(anyhow!("Import report does not exist"))?;

    if report.user_id != user_id {
        return Err(anyhow!(
            "You do not have permission to delete this import report"
        ));
    }

    if report.was_success.is_none() {
        return Err(anyhow!("Cannot delete an import that is still in progress"));
    }

    ImportReport::delete_by_id(import_report_id)
        .exec(&ss.db)
        .await?;

    ryot_log!(debug, "Deleted import report");
    Ok(true)
}
