use std::{sync::Arc, time::Instant};

use apalis::prelude::*;
use background::{ApplicationJob, CoreApplicationJob, ScheduledJob};
use models::CommitMediaInput;
use services::{
    ExerciseService, ExporterService, ImporterService, MiscellaneousService, StatisticsService,
};

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
    Ok(())
}

// Application Jobs

pub async fn perform_core_application_job(
    information: CoreApplicationJob,
    misc_service: Data<Arc<MiscellaneousService>>,
) -> Result<(), Error> {
    let name = information.to_string();
    tracing::trace!("Started job: {:#?}", name);
    let start = Instant::now();
    let status = match information {
        CoreApplicationJob::SyncIntegrationsData(user_id) => misc_service
            .yank_integrations_data_for_user(&user_id)
            .await
            .is_ok(),
        CoreApplicationJob::ReviewPosted(event) => {
            misc_service.handle_review_posted_event(event).await.is_ok()
        }
        CoreApplicationJob::BulkProgressUpdate(user_id, input) => misc_service
            .bulk_progress_update(user_id, input)
            .await
            .is_ok(),
        CoreApplicationJob::EntityAddedToCollection(user_id, collection_to_entity_id) => {
            misc_service
                .handle_entity_added_to_collection_event(user_id, collection_to_entity_id)
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

pub async fn perform_application_job(
    information: ApplicationJob,
    misc_service: Data<Arc<MiscellaneousService>>,
    importer_service: Data<Arc<ImporterService>>,
    exporter_service: Data<Arc<ExporterService>>,
    exercise_service: Data<Arc<ExerciseService>>,
    statistics_service: Data<Arc<StatisticsService>>,
) -> Result<(), Error> {
    let name = information.to_string();
    tracing::trace!("Started job: {:#?}", name);
    let start = Instant::now();
    let status = match information {
        ApplicationJob::ImportFromExternalSource(user_id, input) => importer_service
            .start_importing(user_id, input)
            .await
            .is_ok(),
        ApplicationJob::RecalculateUserActivitiesAndSummary(user_id, calculate_from_beginning) => {
            statistics_service
                .calculate_user_activities_and_summary(&user_id, calculate_from_beginning)
                .await
                .is_ok()
        }
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
