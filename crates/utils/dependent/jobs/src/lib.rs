use std::sync::Arc;

use anyhow::Result;
use background_models::{ApplicationJob, HpApplicationJob, MpApplicationJob};
use common_models::{BackgroundJob, EntityWithLot};
use common_utils::ryot_log;
use database_models::{
    metadata,
    prelude::{Metadata, UserToEntity},
    user_to_entity,
};
use database_utils::admin_account_guard;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, prelude::Expr};
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

pub async fn deploy_update_media_entity_translation_job(
    user_id: &String,
    input: EntityWithLot,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    ss.perform_application_job(ApplicationJob::Mp(
        MpApplicationJob::UpdateMediaEntityTranslation(user_id.to_owned(), input),
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
                .filter(metadata::Column::Id.is_in(many_metadata.clone()))
                .exec(&ss.db)
                .await?;
            ryot_log!(debug, "Marked {} metadata as partial", update.rows_affected);
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
