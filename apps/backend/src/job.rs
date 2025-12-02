use std::sync::Arc;

use apalis::prelude::{Data, Error};
use apalis_cron::CronContext;
use background_models::{
    HpApplicationJob, LpApplicationJob, MpApplicationJob, ScheduledJob, SingleApplicationJob,
};
use common_utils::ryot_log;
use traits::TraceOk;

use crate::common::AppServices;

pub async fn run_infrequent_cron_jobs(
    _information: ScheduledJob,
    ctx: CronContext<chrono_tz::Tz>,
    app_services: Data<Arc<AppServices>>,
) -> Result<(), Error> {
    ryot_log!(debug, "Running job at {:#?}", ctx.get_timestamp());
    app_services
        .miscellaneous_service
        .perform_background_jobs()
        .await
        .trace_ok();
    Ok(())
}

pub async fn run_frequent_cron_jobs(
    _information: ScheduledJob,
    ctx: CronContext<chrono_tz::Tz>,
    app_services: Data<Arc<AppServices>>,
) -> Result<(), Error> {
    ryot_log!(debug, "Running job at {:#?}", ctx.get_timestamp());
    app_services
        .integration_service
        .yank_integrations_data()
        .await
        .trace_ok();
    app_services
        .fitness_service
        .process_users_scheduled_for_workout_revision()
        .await
        .trace_ok();
    app_services
        .miscellaneous_service
        .invalidate_import_jobs()
        .await
        .trace_ok();
    app_services
        .miscellaneous_service
        .cleanup_user_and_metadata_association()
        .await
        .trace_ok();
    Ok(())
}

pub async fn perform_hp_application_job(
    information: HpApplicationJob,
    app_services: Data<Arc<AppServices>>,
) -> Result<(), Error> {
    let name = information.to_string();
    ryot_log!(trace, "Started job {:?}", information);
    let status = match information {
        HpApplicationJob::SyncUserIntegrationsData(user_id) => {
            app_services
                .integration_service
                .sync_integrations_data_for_user(&user_id)
                .await
        }
        HpApplicationJob::RecalculateUserActivitiesAndSummary(
            user_id,
            calculate_from_beginning,
        ) => {
            app_services
                .statistics_service
                .calculate_user_activities_and_summary(&user_id, calculate_from_beginning)
                .await
        }
        HpApplicationJob::ReviewPosted(event) => {
            app_services
                .miscellaneous_service
                .handle_review_posted_event(event)
                .await
        }
        HpApplicationJob::BulkMetadataProgressUpdate(user_id, input) => {
            app_services
                .miscellaneous_service
                .bulk_metadata_progress_update(user_id, input)
                .await
        }
        HpApplicationJob::AddEntitiesToCollection(user_id, input) => app_services
            .collection_service
            .add_entities_to_collection(&user_id, input)
            .await
            .map(|_| ()),
        HpApplicationJob::RemoveEntitiesFromCollection(user_id, input) => app_services
            .collection_service
            .remove_entities_from_collection(&user_id, input)
            .await
            .map(|_| ()),
    };
    ryot_log!(trace, "Finished job {:?}", name);
    status.map_err(|e| Error::Failed(Arc::new(e.to_string().into())))
}

pub async fn perform_mp_application_job(
    information: MpApplicationJob,
    app_services: Data<Arc<AppServices>>,
) -> Result<(), Error> {
    let name = information.to_string();
    ryot_log!(trace, "Started job {:?}", information);
    let status = match information {
        MpApplicationJob::ImportFromExternalSource(user_id, input) => {
            app_services
                .importer_service
                .perform_import(user_id, input)
                .await
        }
        MpApplicationJob::ReviseUserWorkouts(user_id) => {
            app_services
                .fitness_service
                .revise_user_workouts(user_id)
                .await
        }
        MpApplicationJob::UpdateMetadata(metadata_id, user_id) => {
            app_services
                .miscellaneous_service
                .update_metadata_and_notify_users(&metadata_id, user_id)
                .await
        }
        MpApplicationJob::UpdatePerson(person_id, user_id) => {
            app_services
                .miscellaneous_service
                .update_person_and_notify_users(&person_id, user_id)
                .await
        }
        MpApplicationJob::UpdateMetadataGroup(metadata_group_id, user_id) => {
            app_services
                .miscellaneous_service
                .update_metadata_group_and_notify_users(&metadata_group_id, user_id)
                .await
        }
        MpApplicationJob::UpdateGithubExercises => {
            app_services.fitness_service.update_github_exercises().await
        }
        MpApplicationJob::PerformBackgroundTasks => {
            app_services
                .miscellaneous_service
                .perform_background_jobs()
                .await
        }
        MpApplicationJob::PerformExport(user_id) => {
            app_services.exporter_service.perform_export(user_id).await
        }
        MpApplicationJob::UpdateExerciseLibrary => {
            app_services
                .fitness_service
                .deploy_update_exercise_library_job()
                .await
        }
        MpApplicationJob::SyncIntegrationsData => {
            app_services
                .integration_service
                .sync_integrations_data()
                .await
        }
    };
    ryot_log!(trace, "Finished job {:?}", name);
    status.map_err(|e| Error::Failed(Arc::new(e.to_string().into())))
}

pub async fn perform_lp_application_job(
    information: LpApplicationJob,
    app_services: Data<Arc<AppServices>>,
) -> Result<(), Error> {
    let name = information.to_string();
    ryot_log!(trace, "Started job {:?}", information);
    let status = match information {
        LpApplicationJob::HandleEntityAddedToCollectionEvent(collection_to_entity_id) => {
            app_services
                .integration_service
                .handle_entity_added_to_collection_event(collection_to_entity_id)
                .await
                .ok();
            app_services
                .collection_service
                .handle_entity_added_to_collection_event(collection_to_entity_id)
                .await
        }
        LpApplicationJob::HandleOnSeenComplete(id) => {
            app_services
                .integration_service
                .handle_on_seen_complete(id)
                .await
        }
        LpApplicationJob::UpdateUserLastActivityPerformed(user_id, timestamp) => {
            app_services
                .miscellaneous_service
                .update_user_last_activity_performed(user_id, timestamp)
                .await
        }
        LpApplicationJob::HandleMetadataEligibleForSmartCollectionMoving(metadata_id) => {
            app_services
                .miscellaneous_service
                .handle_metadata_eligible_for_smart_collection_moving(metadata_id)
                .await
        }
    };
    ryot_log!(trace, "Finished job {:?}", name);
    status.map_err(|e| Error::Failed(Arc::new(e.to_string().into())))
}

pub async fn perform_single_application_job(
    information: SingleApplicationJob,
    app_services: Data<Arc<AppServices>>,
) -> Result<(), Error> {
    let name = information.to_string();
    ryot_log!(trace, "Started job {:?}", information);
    let status = match information {
        SingleApplicationJob::ProcessIntegrationWebhook(integration_slug, payload) => app_services
            .integration_service
            .process_integration_webhook(integration_slug, payload)
            .await
            .map(|_| ()),
    };
    ryot_log!(trace, "Finished job {:?}", name);
    status.map_err(|e| Error::Failed(Arc::new(e.to_string().into())))
}
