use std::sync::Arc;

use anyhow::Result;
use background_models::{ApplicationJob, HpApplicationJob, MpApplicationJob};
use common_models::BackgroundJob;
use database_models::{metadata, prelude::Metadata};
use database_utils::admin_account_guard;
use sea_orm::{EntityTrait, QueryOrder, QuerySelect, prelude::Expr};
use supporting_service::SupportingService;

pub async fn deploy_update_metadata_job(
    metadata_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    ss.perform_application_job(ApplicationJob::Mp(MpApplicationJob::UpdateMetadata(
        metadata_id.to_owned(),
    )))
    .await?;
    Ok(true)
}

pub async fn deploy_update_metadata_group_job(
    metadata_group_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    ss.perform_application_job(ApplicationJob::Mp(MpApplicationJob::UpdateMetadataGroup(
        metadata_group_id.to_owned(),
    )))
    .await?;
    Ok(true)
}

pub async fn deploy_update_person_job(
    person_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    ss.perform_application_job(ApplicationJob::Mp(MpApplicationJob::UpdatePerson(
        person_id.to_owned(),
    )))
    .await?;
    Ok(true)
}

pub async fn deploy_background_job(
    user_id: &String,
    job_name: BackgroundJob,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    match job_name {
        BackgroundJob::UpdateAllMetadata
        | BackgroundJob::UpdateAllExercises
        | BackgroundJob::PerformBackgroundTasks => {
            admin_account_guard(user_id, ss).await?;
        }
        _ => {}
    }
    match job_name {
        BackgroundJob::UpdateAllMetadata => {
            Metadata::update_many()
                .col_expr(metadata::Column::IsPartial, Expr::value(true))
                .exec(&ss.db)
                .await?;
            let many_metadata = Metadata::find()
                .select_only()
                .column(metadata::Column::Id)
                .order_by_asc(metadata::Column::LastUpdatedOn)
                .into_tuple::<String>()
                .all(&ss.db)
                .await?;
            for metadata_id in many_metadata {
                deploy_update_metadata_job(&metadata_id, ss).await?;
            }
        }
        BackgroundJob::UpdateAllExercises => {
            ss.perform_application_job(ApplicationJob::Mp(MpApplicationJob::UpdateExerciseLibrary))
                .await?;
        }
        BackgroundJob::PerformBackgroundTasks => {
            ss.perform_application_job(ApplicationJob::Mp(
                MpApplicationJob::PerformBackgroundTasks,
            ))
            .await?;
        }
        BackgroundJob::SyncIntegrationsData => {
            ss.perform_application_job(ApplicationJob::Hp(
                HpApplicationJob::SyncUserIntegrationsData(user_id.to_owned()),
            ))
            .await?;
        }
        BackgroundJob::CalculateUserActivitiesAndSummary => {
            ss.perform_application_job(ApplicationJob::Hp(
                HpApplicationJob::RecalculateUserActivitiesAndSummary(user_id.to_owned(), true),
            ))
            .await?;
        }
        BackgroundJob::ReviseUserWorkouts => {
            ss.perform_application_job(ApplicationJob::Mp(MpApplicationJob::ReviseUserWorkouts(
                user_id.to_owned(),
            )))
            .await?;
        }
    };
    Ok(true)
}
