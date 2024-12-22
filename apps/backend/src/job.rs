use std::sync::Arc;

use apalis::prelude::*;
use background_models::{HpApplicationJob, LpApplicationJob, MpApplicationJob, ScheduledJob};
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
    information: HpApplicationJob,
    misc_service: Data<Arc<MiscellaneousService>>,
    statistics_service: Data<Arc<StatisticsService>>,
    integration_service: Data<Arc<IntegrationService>>,
) -> Result<(), Error> {
    ryot_log!(trace, "Started job {:?}", information);
    let status = match information {
        HpApplicationJob::SyncUserIntegrationsData(user_id) => {
            integration_service
                .yank_integrations_data_for_user(&user_id)
                .await
        }
        HpApplicationJob::RecalculateUserActivitiesAndSummary(
            user_id,
            calculate_from_beginning,
        ) => {
            statistics_service
                .calculate_user_activities_and_summary(&user_id, calculate_from_beginning)
                .await
        }
        HpApplicationJob::ReviewPosted(event) => {
            misc_service.handle_review_posted_event(event).await
        }
        HpApplicationJob::BulkProgressUpdate(user_id, input) => {
            misc_service.bulk_progress_update(user_id, input).await
        }
    };
    status.map_err(|e| Error::Failed(Arc::new(e.message.into())))
}

pub async fn perform_mp_application_job(
    information: MpApplicationJob,
    misc_service: Data<Arc<MiscellaneousService>>,
    integration_service: Data<Arc<IntegrationService>>,
    importer_service: Data<Arc<ImporterService>>,
    exporter_service: Data<Arc<ExporterService>>,
    fitness_service: Data<Arc<FitnessService>>,
) -> Result<(), Error> {
    ryot_log!(trace, "Started job {:?}", information);
    let status = match information {
        MpApplicationJob::ImportFromExternalSource(user_id, input) => {
            importer_service.perform_import(user_id, input).await
        }
        MpApplicationJob::ReviseUserWorkouts(user_id) => {
            fitness_service.revise_user_workouts(user_id).await
        }
        MpApplicationJob::UpdateMetadata(metadata_id) => {
            misc_service
                .update_metadata_and_notify_users(&metadata_id)
                .await
        }
        MpApplicationJob::UpdatePerson(person_id) => {
            misc_service
                .update_person_and_notify_users(&person_id)
                .await
        }
        MpApplicationJob::UpdateMetadataGroup(metadata_group_id) => {
            misc_service.update_metadata_group(&metadata_group_id).await
        }
        MpApplicationJob::UpdateGithubExercises => fitness_service.update_github_exercises().await,
        MpApplicationJob::RecalculateCalendarEvents => {
            misc_service.recalculate_calendar_events().await
        }
        MpApplicationJob::PerformBackgroundTasks => misc_service.perform_background_jobs().await,
        MpApplicationJob::PerformExport(user_id) => exporter_service.perform_export(user_id).await,
        MpApplicationJob::UpdateExerciseLibrary => {
            fitness_service.deploy_update_exercise_library_job().await
        }
        MpApplicationJob::SyncIntegrationsData => {
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
    information: LpApplicationJob,
    misc_service: Data<Arc<MiscellaneousService>>,
    integration_service: Data<Arc<IntegrationService>>,
) -> Result<(), Error> {
    ryot_log!(trace, "Started job {:?}", information);
    let status = match information {
        LpApplicationJob::HandleAfterMediaSeenTasks(seen) => {
            misc_service.handle_after_media_seen_tasks(seen).await
        }
        LpApplicationJob::HandleEntityAddedToCollectionEvent(collection_to_entity_id) => {
            integration_service
                .handle_entity_added_to_collection_event(collection_to_entity_id)
                .await
        }
        LpApplicationJob::HandleOnSeenComplete(id) => {
            integration_service.handle_on_seen_complete(id).await
        }
        LpApplicationJob::DeleteAllApplicationCache => {
            misc_service.delete_all_application_cache().await
        }
    };
    status.map_err(|e| Error::Failed(Arc::new(e.message.into())))
}
