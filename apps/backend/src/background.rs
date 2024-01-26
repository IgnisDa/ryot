use std::{sync::Arc, time::Instant};

use apalis::prelude::{Job, JobContext, JobError};
use chrono::DateTime;
use chrono_tz::Tz;
use database::{MetadataLot, MetadataSource};
use serde::{Deserialize, Serialize};
use strum::Display;

use crate::{
    entities::metadata,
    exporter::ExporterService,
    fitness::resolver::ExerciseService,
    importer::{DeployImportJobInput, ImporterService},
    miscellaneous::resolver::MiscellaneousService,
    models::{
        fitness::Exercise,
        media::{PartialMetadataPerson, ProgressUpdateInput, ReviewPostedEvent},
        ExportItem,
    },
};

// Cron Jobs

pub struct ScheduledJob(DateTime<Tz>);

impl From<DateTime<Tz>> for ScheduledJob {
    fn from(value: DateTime<Tz>) -> Self {
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
    tracing::trace!("Checking for updates for media in Watchlist");
    service
        .update_watchlist_media_and_send_notifications()
        .await
        .unwrap();
    tracing::trace!("Checking and sending any pending reminders");
    service.send_pending_media_reminders().await.unwrap();
    tracing::trace!("Recalculating calendar events");
    service.recalculate_calendar_events().await.unwrap();
    tracing::trace!("Sending notifications for released media");
    service
        .send_notifications_for_released_media()
        .await
        .unwrap();
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

// The background jobs which cannot be throttled.
#[derive(Debug, Deserialize, Serialize, Display)]
pub enum CoreApplicationJob {
    YankIntegrationsData(i32),
    BulkProgressUpdate(i32, Vec<ProgressUpdateInput>),
}

impl Job for CoreApplicationJob {
    const NAME: &'static str = "apalis::CoreApplicationJob";
}

pub async fn perform_core_application_job(
    information: CoreApplicationJob,
    ctx: JobContext,
) -> Result<(), JobError> {
    let name = information.to_string();
    tracing::trace!("Started job: {:#?}", name);
    let misc_service = ctx.data::<Arc<MiscellaneousService>>().unwrap();
    let start = Instant::now();
    let status = match information {
        CoreApplicationJob::YankIntegrationsData(user_id) => misc_service
            .yank_integrations_data_for_user(user_id)
            .await
            .is_ok(),
        CoreApplicationJob::BulkProgressUpdate(user_id, input) => misc_service
            .bulk_progress_update(user_id, input)
            .await
            .is_ok(),
    };
    tracing::trace!(
        "Job: {:#?}, Time Taken: {}ms, Successful = {}",
        name,
        (Instant::now() - start).as_millis(),
        status
    );
    Ok(())
}

// The background jobs which can be throttled.
#[derive(Debug, Deserialize, Serialize, Display)]
pub enum ApplicationJob {
    ImportFromExternalSource(i32, DeployImportJobInput),
    ReEvaluateUserWorkouts(i32),
    UpdateMetadata(metadata::Model),
    UpdateExerciseJob(Exercise),
    RecalculateCalendarEvents,
    AssociatePersonWithMetadata(i32, PartialMetadataPerson, usize),
    AssociateGroupWithMetadata(MetadataLot, MetadataSource, String),
    ReviewPosted(ReviewPostedEvent),
    PerformExport(i32, Vec<ExportItem>),
    RecalculateUserSummary(i32),
}

impl Job for ApplicationJob {
    const NAME: &'static str = "apalis::ApplicationJob";
}

pub async fn perform_application_job(
    information: ApplicationJob,
    ctx: JobContext,
) -> Result<(), JobError> {
    let name = information.to_string();
    tracing::trace!("Started job: {:#?}", name);
    let importer_service = ctx.data::<Arc<ImporterService>>().unwrap();
    let exporter_service = ctx.data::<Arc<ExporterService>>().unwrap();
    let misc_service = ctx.data::<Arc<MiscellaneousService>>().unwrap();
    let exercise_service = ctx.data::<Arc<ExerciseService>>().unwrap();
    let start = Instant::now();
    let status = match information {
        ApplicationJob::ImportFromExternalSource(user_id, input) => importer_service
            .start_importing(user_id, input)
            .await
            .is_ok(),
        ApplicationJob::RecalculateUserSummary(user_id) => misc_service
            .calculate_user_summary(user_id, true)
            .await
            .is_ok(),
        ApplicationJob::ReEvaluateUserWorkouts(user_id) => exercise_service
            .re_evaluate_user_workouts(user_id)
            .await
            .is_ok(),
        ApplicationJob::UpdateMetadata(metadata) => {
            let notifications = misc_service.update_metadata(metadata.id).await.unwrap();
            if !notifications.is_empty() {
                let users_to_notify = misc_service
                    .users_to_be_notified_for_state_changes()
                    .await
                    .unwrap()
                    .get(&metadata.id)
                    .cloned()
                    .unwrap_or_default();
                for notification in notifications {
                    for user_id in users_to_notify.iter() {
                        misc_service
                            .send_media_state_changed_notification_for_user(
                                user_id.to_owned(),
                                &notification,
                            )
                            .await
                            .ok();
                    }
                }
            }
            true
        }
        ApplicationJob::UpdateExerciseJob(exercise) => {
            exercise_service.update_exercise(exercise).await.is_ok()
        }
        ApplicationJob::RecalculateCalendarEvents => {
            misc_service.recalculate_calendar_events().await.is_ok()
        }
        ApplicationJob::AssociatePersonWithMetadata(metadata_id, person, index) => misc_service
            .associate_person_with_metadata(metadata_id, person, index)
            .await
            .is_ok(),
        ApplicationJob::AssociateGroupWithMetadata(lot, source, group_identifier) => misc_service
            .associate_group_with_metadata(lot, source, group_identifier)
            .await
            .is_ok(),
        ApplicationJob::ReviewPosted(event) => {
            misc_service.handle_review_posted_event(event).await.is_ok()
        }
        ApplicationJob::PerformExport(user_id, to_export) => exporter_service
            .perform_export(user_id, to_export)
            .await
            .is_ok(),
    };
    tracing::trace!(
        "Job: {:#?}, Time Taken: {}ms, Successful = {}",
        name,
        (Instant::now() - start).as_millis(),
        status
    );
    Ok(())
}
