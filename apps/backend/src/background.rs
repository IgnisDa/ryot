use std::{env, sync::Arc, time::Instant};

use apalis::prelude::{Job, JobContext, JobError};
use chrono::DateTime;
use chrono_tz::Tz;
use database::{MediaLot, MediaSource};
use serde::{Deserialize, Serialize};
use strum::Display;

use crate::{
    exporter::ExporterService,
    fitness::resolver::ExerciseService,
    importer::{DeployImportJobInput, ImporterService},
    miscellaneous::resolver::MiscellaneousService,
    models::{
        fitness::Exercise,
        media::{CommitMediaInput, ProgressUpdateInput, ReviewPostedEvent},
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
    let service = ctx.data::<Arc<MiscellaneousService>>().unwrap();
    if env::var("DISABLE_INVALIDATE_IMPORT_JOBS").is_err() {
        tracing::trace!("Invalidating invalid media import jobs");
        ctx.data::<Arc<ImporterService>>()
            .unwrap()
            .invalidate_import_jobs()
            .await
            .unwrap();
    }
    if env::var("DISABLE_UPDATE_WATCHLIST_MEDIA").is_err() {
        tracing::trace!("Checking for updates for media in Watchlist");
        service
            .update_watchlist_metadata_and_send_notifications()
            .await
            .unwrap();
    }
    if env::var("DISABLE_UPDATE_MONITORED_PEOPLE").is_err() {
        tracing::trace!("Checking for updates for monitored people");
        service
            .update_monitored_people_and_send_notifications()
            .await
            .unwrap();
    }
    if env::var("DISABLE_SEND_PENDING_REMINDERS").is_err() {
        tracing::trace!("Checking and sending any pending reminders");
        service.send_pending_media_reminders().await.unwrap();
    }
    if env::var("DISABLE_RECALCULATE_CALENDAR_EVENTS").is_err() {
        tracing::trace!("Recalculating calendar events");
        service.recalculate_calendar_events().await.unwrap();
    }
    if env::var("DISABLE_SEND_NOTIFICATIONS_FOR_RELEASED_MEDIA").is_err() {
        tracing::trace!("Sending notifications for released media");
        service
            .send_notifications_for_released_media()
            .await
            .unwrap();
    }
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

// The background jobs which can be deployed by the application.
#[derive(Debug, Deserialize, Serialize, Display)]
pub enum ApplicationJob {
    ImportFromExternalSource(i32, Box<DeployImportJobInput>),
    ReEvaluateUserWorkouts(i32),
    UpdateMetadata(i32),
    UpdateExerciseJob(Exercise),
    UpdatePerson(i32),
    RecalculateCalendarEvents,
    AssociateGroupWithMetadata(MediaLot, MediaSource, String),
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
        ApplicationJob::UpdateMetadata(metadata_id) => misc_service
            .update_metadata_and_notify_users(metadata_id)
            .await
            .is_ok(),
        ApplicationJob::UpdatePerson(person_id) => misc_service
            .update_person_and_notify_users(person_id)
            .await
            .is_ok(),
        ApplicationJob::UpdateExerciseJob(exercise) => {
            exercise_service.update_exercise(exercise).await.is_ok()
        }
        ApplicationJob::RecalculateCalendarEvents => {
            misc_service.recalculate_calendar_events().await.is_ok()
        }
        ApplicationJob::AssociateGroupWithMetadata(lot, source, identifier) => misc_service
            .commit_metadata_group(CommitMediaInput {
                lot,
                source,
                identifier,
            })
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
