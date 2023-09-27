use std::{sync::Arc, time::Instant};

use apalis::prelude::{Job, JobContext, JobError};
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use strum::Display;

use crate::{
    entities::{metadata, seen},
    fitness::resolver::ExerciseService,
    importer::{DeployImportJobInput, ImporterService},
    miscellaneous::resolver::MiscellaneousService,
    models::{fitness::Exercise, media::PartialMetadataPerson},
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
    tracing::trace!("Recalculating calendar events");
    service.recalculate_calendar_events().await.unwrap();
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

#[derive(Debug, Deserialize, Serialize, Display)]
pub enum ApplicationJob {
    ImportMedia(i32, DeployImportJobInput),
    UserCreated(i32),
    RecalculateUserSummary(i32),
    UpdateMetadata(metadata::Model),
    UpdateExerciseJob(Exercise),
    AfterMediaSeen(seen::Model),
    RecalculateCalendarEvents,
    AssociatePersonWithMetadata(i32, PartialMetadataPerson, usize),
}

impl Job for ApplicationJob {
    const NAME: &'static str = "apalis::ApplicationJob";
}

pub async fn perform_application_job(
    information: ApplicationJob,
    ctx: JobContext,
) -> Result<(), JobError> {
    let name = information.to_string();
    let importer_service = ctx.data::<Arc<ImporterService>>().unwrap();
    let misc_service = ctx.data::<Arc<MiscellaneousService>>().unwrap();
    let exercise_service = ctx.data::<Arc<ExerciseService>>().unwrap();
    let start = Instant::now();
    match information {
        ApplicationJob::ImportMedia(user_id, input) => {
            importer_service
                .import_from_lot(user_id, input)
                .await
                .unwrap();
        }
        ApplicationJob::UserCreated(user_id) => {
            misc_service.user_created_job(user_id).await.unwrap();
            misc_service.user_created_job(user_id).await.unwrap();
            misc_service.calculate_user_summary(user_id).await.unwrap();
        }
        ApplicationJob::RecalculateUserSummary(user_id) => {
            misc_service.calculate_user_summary(user_id).await.unwrap();
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
            exercise_service.update_exercise(exercise).await.unwrap();
        }
        ApplicationJob::AfterMediaSeen(seen) => {
            misc_service.after_media_seen_tasks(seen).await.unwrap();
        }
        ApplicationJob::RecalculateCalendarEvents => {
            misc_service.recalculate_calendar_events().await.unwrap();
        }
        ApplicationJob::AssociatePersonWithMetadata(metadata_id, person, index) => {
            misc_service
                .associate_person_with_metadata(metadata_id, person, index)
                .await
                .unwrap();
        }
    };
    let end = Instant::now();
    tracing::trace!(
        "Job {:#?} completed in {}ms",
        name,
        (end - start).as_millis()
    );
    Ok(())
}
