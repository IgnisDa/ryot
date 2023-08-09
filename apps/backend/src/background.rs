use std::sync::Arc;

use apalis::prelude::{Job, JobContext, JobError};
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};

use crate::{
    entities::metadata,
    fitness::exercise::resolver::ExerciseService,
    importer::{DeployImportJobInput, ImporterService},
    miscellaneous::resolver::MiscellaneousService,
    models::fitness::Exercise,
};

// Cron Jobs

#[derive(Debug, Deserialize, Serialize)]
pub struct ScheduledJob(DateTimeUtc);

impl From<DateTimeUtc> for ScheduledJob {
    fn from(value: DateTimeUtc) -> Self {
        Self(value)
    }
}

impl Job for ScheduledJob {
    const NAME: &'static str = "apalis::ScheduledJob";
}

pub async fn media_jobs(_information: ScheduledJob, ctx: JobContext) -> Result<(), JobError> {
    tracing::trace!("Invalidating invalid media import jobs");
    ctx.data::<Arc<ImporterService>>()
        .unwrap()
        .invalidate_import_jobs()
        .await
        .unwrap();
    let service = ctx.data::<Arc<MiscellaneousService>>().unwrap();
    service
        .cleanup_data_without_associated_user_activities()
        .await
        .unwrap();
    tracing::trace!("Checking for updates for media in Watchlist");
    service
        .update_watchlist_media_and_send_notifications()
        .await
        .unwrap();
    tracing::trace!("Checking and sending any pending reminders");
    service.send_pending_media_reminders().await.unwrap();
    Ok(())
}

pub async fn user_jobs(_information: ScheduledJob, ctx: JobContext) -> Result<(), JobError> {
    tracing::trace!("Cleaning up user and metadata association");
    ctx.data::<Arc<MiscellaneousService>>()
        .unwrap()
        .cleanup_user_and_metadata_association()
        .await
        .unwrap();
    tracing::trace!("Removing old user summaries and regenerating them");
    ctx.data::<Arc<MiscellaneousService>>()
        .unwrap()
        .regenerate_user_summaries()
        .await
        .unwrap();
    tracing::trace!("Removing old user authentication tokens");
    ctx.data::<Arc<MiscellaneousService>>()
        .unwrap()
        .delete_expired_user_auth_tokens()
        .await
        .unwrap();
    Ok(())
}

pub async fn yank_integrations_data(
    _information: ScheduledJob,
    ctx: JobContext,
) -> Result<(), JobError> {
    tracing::trace!("Getting data from yanked integrations for all users");
    ctx.data::<Arc<MiscellaneousService>>()
        .unwrap()
        .yank_integrations_data()
        .await
        .unwrap();
    Ok(())
}

// Application Jobs

#[derive(Debug, Deserialize, Serialize)]
pub struct ImportMedia {
    pub user_id: i32,
    pub input: DeployImportJobInput,
}

impl Job for ImportMedia {
    const NAME: &'static str = "apalis::ImportMedia";
}

pub async fn import_media(information: ImportMedia, ctx: JobContext) -> Result<(), JobError> {
    tracing::trace!("Importing media");
    ctx.data::<Arc<ImporterService>>()
        .unwrap()
        .import_from_source(information.user_id, information.input)
        .await
        .unwrap();
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct UserCreatedJob {
    pub user_id: i32,
}

impl Job for UserCreatedJob {
    const NAME: &'static str = "apalis::UserCreatedJob";
}

pub async fn user_created_job(
    information: UserCreatedJob,
    ctx: JobContext,
) -> Result<(), JobError> {
    tracing::trace!("Running jobs after user creation");
    let service = ctx.data::<Arc<MiscellaneousService>>().unwrap();
    service.user_created_job(information.user_id).await.unwrap();
    service.user_created_job(information.user_id).await.unwrap();
    service
        .calculate_user_media_summary(information.user_id)
        .await
        .unwrap();
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct RecalculateUserSummaryJob {
    pub user_id: i32,
}

impl Job for RecalculateUserSummaryJob {
    const NAME: &'static str = "apalis::RecalculateUserSummaryJob";
}

pub async fn recalculate_user_summary_job(
    information: RecalculateUserSummaryJob,
    ctx: JobContext,
) -> Result<(), JobError> {
    tracing::trace!("Calculating summary for user {:?}", information.user_id);
    ctx.data::<Arc<MiscellaneousService>>()
        .unwrap()
        .calculate_user_media_summary(information.user_id)
        .await
        .unwrap();
    tracing::trace!(
        "Summary calculation complete for user {:?}",
        information.user_id
    );
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct UpdateMetadataJob {
    pub metadata: metadata::Model,
}

impl Job for UpdateMetadataJob {
    const NAME: &'static str = "apalis::UpdateMetadataJob";
}

pub async fn update_metadata_job(
    information: UpdateMetadataJob,
    ctx: JobContext,
) -> Result<(), JobError> {
    let service = ctx.data::<Arc<MiscellaneousService>>().unwrap();
    let notifications = service
        .update_metadata(information.metadata.id)
        .await
        .unwrap();
    if !notifications.is_empty() {
        for notification in notifications {
            let user_ids = service
                .users_to_be_notified_for_state_changes(information.metadata.id)
                .await
                .unwrap();
            for user_id in user_ids {
                service
                    .send_media_state_changed_notification_for_user(user_id, &notification)
                    .await
                    .unwrap();
            }
        }
    }
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct UpdateExerciseJob {
    pub exercise: Exercise,
}

impl Job for UpdateExerciseJob {
    const NAME: &'static str = "apalis::UpdateExerciseJob";
}

pub async fn update_exercise_job(
    information: UpdateExerciseJob,
    ctx: JobContext,
) -> Result<(), JobError> {
    tracing::trace!("Updating {:?}", information.exercise.name);
    ctx.data::<Arc<ExerciseService>>()
        .unwrap()
        .update_exercise(information.exercise)
        .await
        .unwrap();
    Ok(())
}
