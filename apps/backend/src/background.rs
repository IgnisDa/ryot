use std::sync::Arc;

use apalis::prelude::{Job, JobContext, JobError};
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};

use crate::{
    entities::{metadata, seen},
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
pub enum ApplicationJob {
    ImportMedia(i32, DeployImportJobInput),
    UserCreated(i32),
    RecalculateUserSummary(i32),
    UpdateMetadata(metadata::Model),
    UpdateExerciseJob(Exercise),
    AfterMediaSeen(seen::Model),
}

impl Job for ApplicationJob {
    const NAME: &'static str = "apalis::ApplicationJob";
}

pub async fn perform_application_job(
    information: ApplicationJob,
    ctx: JobContext,
) -> Result<(), JobError> {
    let importer_service = ctx.data::<Arc<ImporterService>>().unwrap();
    let misc_service = ctx.data::<Arc<MiscellaneousService>>().unwrap();
    let exercise_service = ctx.data::<Arc<ExerciseService>>().unwrap();
    match information {
        ApplicationJob::ImportMedia(user_id, input) => {
            tracing::trace!("Importing media");
            importer_service
                .import_from_lot(user_id, input)
                .await
                .unwrap();
        }
        ApplicationJob::UserCreated(user_id) => {
            tracing::trace!("Running jobs after user creation");
            misc_service.user_created_job(user_id).await.unwrap();
            misc_service.user_created_job(user_id).await.unwrap();
            misc_service.calculate_user_summary(user_id).await.unwrap();
        }
        ApplicationJob::RecalculateUserSummary(user_id) => {
            tracing::trace!("Calculating summary for user {:?}", user_id);
            misc_service.calculate_user_summary(user_id).await.unwrap();
            tracing::trace!("Summary calculation complete for user {:?}", user_id);
        }
        ApplicationJob::UpdateMetadata(metadata) => {
            let notifications = misc_service.update_metadata(metadata.id).await.unwrap();
            if !notifications.is_empty() {
                for notification in notifications {
                    let user_ids = misc_service
                        .users_to_be_notified_for_state_changes(metadata.id)
                        .await
                        .unwrap();
                    for user_id in user_ids {
                        misc_service
                            .send_media_state_changed_notification_for_user(user_id, &notification)
                            .await
                            .unwrap();
                    }
                }
            }
        }
        ApplicationJob::UpdateExerciseJob(exercise) => {
            tracing::trace!("Updating {:?}", exercise.name);
            exercise_service.update_exercise(exercise).await.unwrap();
        }
        ApplicationJob::AfterMediaSeen(seen) => {
            tracing::trace!("Performing jobs aftter media seen = {:?}", seen.id);
            misc_service.after_media_seen_tasks(seen).await.unwrap();
        }
    };
    Ok(())
}
