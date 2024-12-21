use std::{sync::Arc, time::Instant};

use apalis::prelude::*;
use background_models::{HighPriorityApplicationJob, MediumPriorityApplicationJob, ScheduledJob};
use common_utils::ryot_log;
use exporter_service::ExporterService;
use fitness_service::FitnessService;
use importer_service::ImporterService;
use integration_service::IntegrationService;
use miscellaneous_service::MiscellaneousService;
use statistics_service::StatisticsService;
use traits::TraceOk;

pub async fn run_background_jobs(
    information: ScheduledJob,
    misc_service: Data<Arc<MiscellaneousService>>,
) -> Result<(), Error> {
    ryot_log!(debug, "Running job at {:#?}", information.0);
    misc_service.perform_background_jobs().await.trace_ok();
    Ok(())
}

pub async fn run_frequent_jobs(
    _information: ScheduledJob,
    fitness_service: Data<Arc<FitnessService>>,
    integration_service: Data<Arc<IntegrationService>>,
) -> Result<(), Error> {
    integration_service
        .yank_integrations_data()
        .await
        .trace_ok();
    fitness_service
        .process_users_scheduled_for_workout_revision()
        .await
        .trace_ok();
    Ok(())
}

pub async fn perform_core_application_job(
    information: HighPriorityApplicationJob,
    integration_service: Data<Arc<IntegrationService>>,
    misc_service: Data<Arc<MiscellaneousService>>,
) -> Result<(), Error> {
    let name = information.to_string();
    ryot_log!(trace, "Started job {:?}", information);
    let start = Instant::now();
    let status = match information {
        HighPriorityApplicationJob::SyncIntegrationsData(user_id) => integration_service
            .yank_integrations_data_for_user(&user_id)
            .await
            .is_ok(),
        HighPriorityApplicationJob::ReviewPosted(event) => {
            misc_service.handle_review_posted_event(event).await.is_ok()
        }
        HighPriorityApplicationJob::BulkProgressUpdate(user_id, input) => misc_service
            .bulk_progress_update(user_id, input)
            .await
            .is_ok(),
    };
    ryot_log!(
        trace,
        "Job: {:#?}, Time Taken: {}ms, Successful = {}",
        name,
        (Instant::now() - start).as_millis(),
        status
    );
    Ok(())
}

pub async fn perform_application_job(
    information: MediumPriorityApplicationJob,
    misc_service: Data<Arc<MiscellaneousService>>,
    integration_service: Data<Arc<IntegrationService>>,
    importer_service: Data<Arc<ImporterService>>,
    exporter_service: Data<Arc<ExporterService>>,
    fitness_service: Data<Arc<FitnessService>>,
    statistics_service: Data<Arc<StatisticsService>>,
) -> Result<(), Error> {
    let name = information.to_string();
    ryot_log!(trace, "Started job {:?}", information);
    let start = Instant::now();
    let status = match information {
        MediumPriorityApplicationJob::ImportFromExternalSource(user_id, input) => importer_service
            .perform_import(user_id, input)
            .await
            .is_ok(),
        MediumPriorityApplicationJob::RecalculateUserActivitiesAndSummary(
            user_id,
            calculate_from_beginning,
        ) => statistics_service
            .calculate_user_activities_and_summary(&user_id, calculate_from_beginning)
            .await
            .is_ok(),
        MediumPriorityApplicationJob::ReviseUserWorkouts(user_id) => {
            fitness_service.revise_user_workouts(user_id).await.is_ok()
        }
        MediumPriorityApplicationJob::UpdateMetadata(metadata_id) => misc_service
            .update_metadata_and_notify_users(&metadata_id)
            .await
            .is_ok(),
        MediumPriorityApplicationJob::UpdatePerson(person_id) => misc_service
            .update_person_and_notify_users(&person_id)
            .await
            .is_ok(),
        MediumPriorityApplicationJob::HandleAfterMediaSeenTasks(seen) => misc_service
            .handle_after_media_seen_tasks(seen)
            .await
            .is_ok(),
        MediumPriorityApplicationJob::UpdateMetadataGroup(metadata_group_id) => misc_service
            .update_metadata_group(&metadata_group_id)
            .await
            .is_ok(),
        MediumPriorityApplicationJob::UpdateGithubExercises => {
            fitness_service.update_github_exercises().await.is_ok()
        }
        MediumPriorityApplicationJob::RecalculateCalendarEvents => {
            misc_service.recalculate_calendar_events().await.is_ok()
        }
        MediumPriorityApplicationJob::PerformBackgroundTasks => {
            misc_service.perform_background_jobs().await.is_ok()
        }
        MediumPriorityApplicationJob::AssociateGroupWithMetadata(input) => {
            misc_service.commit_metadata_group(input).await.is_ok()
        }
        MediumPriorityApplicationJob::PerformExport(user_id) => {
            exporter_service.perform_export(user_id).await.is_ok()
        }
        MediumPriorityApplicationJob::UpdateExerciseLibrary => fitness_service
            .deploy_update_exercise_library_job()
            .await
            .is_ok(),
        MediumPriorityApplicationJob::SyncIntegrationsData => {
            integration_service
                .yank_integrations_data()
                .await
                .trace_ok();
            integration_service
                .sync_integrations_data_to_owned_collection()
                .await
                .is_ok()
        }
        MediumPriorityApplicationJob::HandleEntityAddedToCollectionEvent(
            collection_to_entity_id,
        ) => integration_service
            .handle_entity_added_to_collection_event(collection_to_entity_id)
            .await
            .is_ok(),
        MediumPriorityApplicationJob::HandleOnSeenComplete(id) => integration_service
            .handle_on_seen_complete(id)
            .await
            .is_ok(),
    };
    ryot_log!(
        trace,
        "Job: {:#?}, Time Taken: {}ms, Successful = {}",
        name,
        (Instant::now() - start).as_millis(),
        status
    );
    Ok(())
}
