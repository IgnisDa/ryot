use std::{sync::Arc, time::Instant};

use apalis::prelude::*;
use chrono::DateTime;
use chrono_tz::Tz;
use database::{MediaLot, MediaSource};
use serde::{Deserialize, Serialize};
use strum::Display;
use uuid::Uuid;

use crate::{
    exporter::ExporterService,
    fitness::resolver::ExerciseService,
    importer::{DeployImportJobInput, ImporterService},
    miscellaneous::MiscellaneousService,
    models::{
        fitness::Exercise,
        media::{CommitMediaInput, ProgressUpdateInput, ReviewPostedEvent},
        ExportItem,
    },
};

// Cron Jobs

pub struct ScheduledJob(pub DateTime<Tz>);

impl From<DateTime<Tz>> for ScheduledJob {
    fn from(value: DateTime<Tz>) -> Self {
        Self(value)
    }
}

impl Job for ScheduledJob {
    const NAME: &'static str = "apalis::ScheduledJob";
}

pub async fn background_jobs(
    information: ScheduledJob,
    misc_service: Data<Arc<MiscellaneousService>>,
) -> Result<(), Error> {
    tracing::debug!("Running job at {:#?}", information.0);
    misc_service.perform_background_jobs().await.unwrap();
    Ok(())
}

pub async fn sync_integrations_data(
    _information: ScheduledJob,
    misc_service: Data<Arc<MiscellaneousService>>,
) -> Result<(), Error> {
    tracing::trace!("Getting data from yanked integrations for all users");
    misc_service.yank_integrations_data().await.unwrap();
    tracing::trace!("Sending data for push integrations for all users");
    misc_service
        .send_data_for_push_integrations()
        .await
        .unwrap();
    Ok(())
}

// Application Jobs

// The background jobs which cannot be throttled.
#[derive(Debug, Deserialize, Serialize, Display)]
pub enum CoreApplicationJob {
    SyncIntegrationsData(String),
    ReviewPosted(ReviewPostedEvent),
    BulkProgressUpdate(String, Vec<ProgressUpdateInput>),
    EntityAddedToCollection(Uuid, String),
}

impl Message for CoreApplicationJob {
    const NAME: &'static str = "apalis::CoreApplicationJob";
}

pub async fn perform_core_application_job(
    information: CoreApplicationJob,
    misc_service: Data<Arc<MiscellaneousService>>,
) -> Result<(), Error> {
    let name = information.to_string();
    tracing::trace!("Started job: {:#?}", name);
    let start = Instant::now();
    let status = match information {
        CoreApplicationJob::SyncIntegrationsData(user_id) => {
            misc_service
                .push_integrations_data_for_user(&user_id)
                .await
                .ok();
            misc_service
                .yank_integrations_data_for_user(&user_id)
                .await
                .is_ok()
        }
        CoreApplicationJob::ReviewPosted(event) => {
            misc_service.handle_review_posted_event(event).await.is_ok()
        }
        CoreApplicationJob::BulkProgressUpdate(user_id, input) => misc_service
            .bulk_progress_update(user_id, input)
            .await
            .is_ok(),
        CoreApplicationJob::EntityAddedToCollection(collection_to_entity_id, user_id) => {
            misc_service
                .handle_entity_added_to_collection_event(collection_to_entity_id, user_id)
                .await
                .is_ok()
        }
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
    ImportFromExternalSource(String, Box<DeployImportJobInput>),
    ReEvaluateUserWorkouts(String),
    UpdateMetadata(String, bool),
    UpdateGithubExerciseJob(Exercise),
    UpdatePerson(String),
    RecalculateCalendarEvents,
    AssociateGroupWithMetadata(MediaLot, MediaSource, String),
    PerformExport(String, Vec<ExportItem>),
    RecalculateUserSummary(String),
    PerformBackgroundTasks,
    UpdateExerciseLibrary,
}

impl Message for ApplicationJob {
    const NAME: &'static str = "apalis::ApplicationJob";
}

pub async fn perform_application_job(
    information: ApplicationJob,
    misc_service: Data<Arc<MiscellaneousService>>,
    importer_service: Data<Arc<ImporterService>>,
    exporter_service: Data<Arc<ExporterService>>,
    exercise_service: Data<Arc<ExerciseService>>,
) -> Result<(), Error> {
    let name = information.to_string();
    tracing::trace!("Started job: {:#?}", name);
    let start = Instant::now();
    let status = match information {
        ApplicationJob::ImportFromExternalSource(user_id, input) => importer_service
            .start_importing(user_id, input)
            .await
            .is_ok(),
        ApplicationJob::RecalculateUserSummary(user_id) => misc_service
            .calculate_user_summary(&user_id, true)
            .await
            .is_ok(),
        ApplicationJob::ReEvaluateUserWorkouts(user_id) => exercise_service
            .re_evaluate_user_workouts(user_id)
            .await
            .is_ok(),
        ApplicationJob::UpdateMetadata(metadata_id, force_update) => misc_service
            .update_metadata_and_notify_users(&metadata_id, force_update)
            .await
            .is_ok(),
        ApplicationJob::UpdatePerson(person_id) => misc_service
            .update_person_and_notify_users(person_id)
            .await
            .is_ok(),
        ApplicationJob::UpdateGithubExerciseJob(exercise) => exercise_service
            .update_github_exercise(exercise)
            .await
            .is_ok(),
        ApplicationJob::RecalculateCalendarEvents => {
            misc_service.recalculate_calendar_events().await.is_ok()
        }
        ApplicationJob::PerformBackgroundTasks => {
            misc_service.perform_background_jobs().await.is_ok()
        }
        ApplicationJob::AssociateGroupWithMetadata(lot, source, identifier) => misc_service
            .commit_metadata_group(CommitMediaInput {
                lot,
                source,
                identifier,
                force_update: None,
            })
            .await
            .is_ok(),
        ApplicationJob::PerformExport(user_id, to_export) => exporter_service
            .perform_export(user_id, to_export)
            .await
            .is_ok(),
        ApplicationJob::UpdateExerciseLibrary => exercise_service
            .deploy_update_exercise_library_job()
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
