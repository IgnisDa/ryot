use std::sync::Arc;

use anyhow::Result;
use background_models::{ApplicationJob, HpApplicationJob, MpApplicationJob};
use common_models::{BackgroundJob, EntityWithLot};
use database_models::{
    metadata,
    prelude::{Metadata, UserToEntity},
    user_to_entity,
};
use database_utils::admin_account_guard;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, prelude::Expr};
use supporting_service::SupportingService;

pub async fn deploy_update_media_entity_job(
    input: EntityWithLot,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    ss.perform_application_job(ApplicationJob::Mp(MpApplicationJob::UpdateMediaDetails(
        input,
    )))
    .await?;
    Ok(true)
}

pub async fn deploy_update_media_translations_job(
    user_id: String,
    input: EntityWithLot,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    ss.perform_application_job(ApplicationJob::Mp(
        MpApplicationJob::UpdateMediaTranslations(user_id, input),
    ))
    .await?;
    Ok(true)
}

pub async fn deploy_background_job(
    user_id: &String,
    job_name: BackgroundJob,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    let requires_admin = matches!(
        job_name,
        BackgroundJob::UpdateAllMetadata
            | BackgroundJob::UpdateAllExercises
            | BackgroundJob::PerformBackgroundTasks
    );
    if requires_admin {
        admin_account_guard(user_id, ss).await?;
    }

    match job_name {
        BackgroundJob::UpdateAllMetadata => {
            let many_metadata = UserToEntity::find()
                .select_only()
                .column(user_to_entity::Column::MetadataId)
                .filter(user_to_entity::Column::UserId.is_not_null())
                .filter(user_to_entity::Column::MetadataId.is_not_null())
                .order_by_asc(user_to_entity::Column::CreatedOn)
                .into_tuple::<String>()
                .all(&ss.db)
                .await?;
            let update = Metadata::update_many()
                .col_expr(metadata::Column::IsPartial, Expr::value(true))
                .filter(metadata::Column::Id.is_in(many_metadata))
                .exec(&ss.db)
                .await?;
            tracing::debug!("Marked {} metadata as partial", update.rows_affected);
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
