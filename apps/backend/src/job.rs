use std::sync::Arc;

use apalis::prelude::*;
use background_models::{
    HighPriorityApplicationJob, LowPriorityApplicationJob, MediumPriorityApplicationJob,
    ScheduledJob,
};
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

pub async fn perform_hp_application_job(
    information: HighPriorityApplicationJob,
    integration_service: Data<Arc<IntegrationService>>,
    misc_service: Data<Arc<MiscellaneousService>>,
) -> Result<(), Error> {
    ryot_log!(trace, "Started job {:?}", information);
    let status = match information {
        HighPriorityApplicationJob::SyncUserIntegrationsData(user_id) => {
            integration_service
                .yank_integrations_data_for_user(&user_id)
                .await
        }
        HighPriorityApplicationJob::ReviewPosted(event) => {
            misc_service.handle_review_posted_event(event).await
        }
        HighPriorityApplicationJob::BulkProgressUpdate(user_id, input) => {
            misc_service.bulk_progress_update(user_id, input).await
        }
    };
    status.map_err(|e| Error::Failed(Arc::new(e.message.into())))
}

pub async fn perform_mp_application_job(
    information: MediumPriorityApplicationJob,
    misc_service: Data<Arc<MiscellaneousService>>,
    integration_service: Data<Arc<IntegrationService>>,
    importer_service: Data<Arc<ImporterService>>,
    exporter_service: Data<Arc<ExporterService>>,
    fitness_service: Data<Arc<FitnessService>>,
) -> Result<(), Error> {
    ryot_log!(trace, "Started job {:?}", information);
    let status = match information {
        MediumPriorityApplicationJob::ImportFromExternalSource(user_id, input) => {
            importer_service.perform_import(user_id, input).await
        }
        MediumPriorityApplicationJob::ReviseUserWorkouts(user_id) => {
            fitness_service.revise_user_workouts(user_id).await
        }
        MediumPriorityApplicationJob::UpdateMetadata(metadata_id) => {
            misc_service
                .update_metadata_and_notify_users(&metadata_id)
                .await
        }
        MediumPriorityApplicationJob::UpdatePerson(person_id) => {
            misc_service
                .update_person_and_notify_users(&person_id)
                .await
        }
        MediumPriorityApplicationJob::UpdateMetadataGroup(metadata_group_id) => {
            misc_service.update_metadata_group(&metadata_group_id).await
        }
        MediumPriorityApplicationJob::UpdateGithubExercises => {
            fitness_service.update_github_exercises().await
        }
        MediumPriorityApplicationJob::RecalculateCalendarEvents => {
            misc_service.recalculate_calendar_events().await
        }
        MediumPriorityApplicationJob::PerformBackgroundTasks => {
            misc_service.perform_background_jobs().await
        }
        MediumPriorityApplicationJob::PerformExport(user_id) => {
            exporter_service.perform_export(user_id).await
        }
        MediumPriorityApplicationJob::UpdateExerciseLibrary => {
            fitness_service.deploy_update_exercise_library_job().await
        }
        MediumPriorityApplicationJob::SyncIntegrationsData => {
            integration_service
                .yank_integrations_data()
                .await
                .trace_ok();
            integration_service
                .sync_integrations_data_to_owned_collection()
                .await
        }
    };
    status.map_err(|e| Error::Failed(Arc::new(e.message.into())))
}

pub async fn perform_lp_application_job(
    information: LowPriorityApplicationJob,
    misc_service: Data<Arc<MiscellaneousService>>,
    integration_service: Data<Arc<IntegrationService>>,
    statistics_service: Data<Arc<StatisticsService>>,
) -> Result<(), Error> {
    ryot_log!(trace, "Started job {:?}", information);
    let status = match information {
        LowPriorityApplicationJob::RecalculateUserActivitiesAndSummary(
            user_id,
            calculate_from_beginning,
        ) => {
            statistics_service
                .calculate_user_activities_and_summary(&user_id, calculate_from_beginning)
                .await
        }
        LowPriorityApplicationJob::HandleAfterMediaSeenTasks(seen) => {
            misc_service.handle_after_media_seen_tasks(seen).await
        }
        LowPriorityApplicationJob::HandleEntityAddedToCollectionEvent(collection_to_entity_id) => {
            integration_service
                .handle_entity_added_to_collection_event(collection_to_entity_id)
                .await
        }
        LowPriorityApplicationJob::HandleOnSeenComplete(id) => {
            integration_service.handle_on_seen_complete(id).await
        }
    };
    status.map_err(|e| Error::Failed(Arc::new(e.message.into())))
}
