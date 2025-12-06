use std::sync::Arc;

use apalis::prelude::{Data, Error};
use apalis_cron::CronContext;
use background_models::{
    HpApplicationJob, LpApplicationJob, MpApplicationJob, ScheduledJob, SingleApplicationJob,
};
use collection_service::event_operations;
use common_utils::ryot_log;
use dependent_collection_utils::{add_entities_to_collection, remove_entities_from_collection};
use exporter_service::export_operations::perform_export;
use fitness_service::{
    deploy_update_exercise_library_job, process_users_scheduled_for_workout_revision,
    revise_user_workouts, update_github_exercises,
};
use importer_service::perform_import;
use integration_service::{
    handle_entity_added_to_collection_event, handle_on_seen_complete, process_integration_webhook,
    sync_integrations_data, sync_integrations_data_for_user, yank_integrations_data,
};
use miscellaneous_media_translation_service::update_media_entity_translation;
use miscellaneous_service::{
    bulk_metadata_progress_update_for_user, cleanup_user_and_metadata_association,
    handle_metadata_eligible_for_smart_collection_moving, handle_review_posted_event,
    invalidate_import_jobs, perform_background_jobs, update_metadata_and_notify_users_for_id,
    update_metadata_group_and_notify_users_for_id, update_person_and_notify_users_for_id,
    update_user_last_activity_performed,
};
use statistics_service::calculate_user_activities_and_summary_for_user;
use supporting_service::SupportingService;
use traits::TraceOk;

pub async fn run_infrequent_cron_jobs(
    _information: ScheduledJob,
    ctx: CronContext<chrono_tz::Tz>,
    ss: Data<Arc<SupportingService>>,
) -> Result<(), Error> {
    ryot_log!(debug, "Running job at {:#?}", ctx.get_timestamp());
    perform_background_jobs(&ss).await.trace_ok();
    Ok(())
}

pub async fn run_frequent_cron_jobs(
    _information: ScheduledJob,
    ctx: CronContext<chrono_tz::Tz>,
    ss: Data<Arc<SupportingService>>,
) -> Result<(), Error> {
    ryot_log!(debug, "Running job at {:#?}", ctx.get_timestamp());
    yank_integrations_data(&ss).await.trace_ok();
    process_users_scheduled_for_workout_revision(&ss)
        .await
        .trace_ok();
    invalidate_import_jobs(&ss).await.trace_ok();
    cleanup_user_and_metadata_association(&ss).await.trace_ok();
    Ok(())
}

pub async fn perform_hp_application_job(
    information: HpApplicationJob,
    ss: Data<Arc<SupportingService>>,
) -> Result<(), Error> {
    let name = information.to_string();
    ryot_log!(trace, "Started job {:?}", information);
    let status = match information {
        HpApplicationJob::SyncUserIntegrationsData(user_id) => {
            sync_integrations_data_for_user(&ss, &user_id).await
        }
        HpApplicationJob::RecalculateUserActivitiesAndSummary(
            user_id,
            calculate_from_beginning,
        ) => {
            calculate_user_activities_and_summary_for_user(&ss, &user_id, calculate_from_beginning)
                .await
        }
        HpApplicationJob::ReviewPosted(event) => handle_review_posted_event(&ss, event).await,
        HpApplicationJob::BulkMetadataProgressUpdate(user_id, input) => {
            bulk_metadata_progress_update_for_user(&ss, user_id, input).await
        }
        HpApplicationJob::AddEntitiesToCollection(user_id, input) => {
            add_entities_to_collection(&user_id, input, &ss)
                .await
                .map(|_| ())
        }
        HpApplicationJob::RemoveEntitiesFromCollection(user_id, input) => {
            remove_entities_from_collection(&user_id, input, &ss)
                .await
                .map(|_| ())
        }
    };
    ryot_log!(trace, "Finished job {:?}", name);
    status.map_err(|e| Error::Failed(Arc::new(e.to_string().into())))
}

pub async fn perform_mp_application_job(
    information: MpApplicationJob,
    ss: Data<Arc<SupportingService>>,
) -> Result<(), Error> {
    let name = information.to_string();
    ryot_log!(trace, "Started job {:?}", information);
    let status = match information {
        MpApplicationJob::ImportFromExternalSource(user_id, input) => {
            perform_import(&ss, user_id, input).await
        }
        MpApplicationJob::ReviseUserWorkouts(user_id) => revise_user_workouts(&ss, user_id).await,
        MpApplicationJob::UpdateMetadata(metadata_id) => {
            update_metadata_and_notify_users_for_id(&ss, &metadata_id).await
        }
        MpApplicationJob::UpdatePerson(person_id) => {
            update_person_and_notify_users_for_id(&ss, &person_id).await
        }
        MpApplicationJob::UpdateMetadataGroup(metadata_group_id) => {
            update_metadata_group_and_notify_users_for_id(&ss, &metadata_group_id).await
        }
        MpApplicationJob::UpdateGithubExercises => update_github_exercises(&ss).await,
        MpApplicationJob::PerformBackgroundTasks => perform_background_jobs(&ss).await,
        MpApplicationJob::PerformExport(user_id) => perform_export(&ss, user_id).await,
        MpApplicationJob::UpdateExerciseLibrary => deploy_update_exercise_library_job(&ss).await,
        MpApplicationJob::SyncIntegrationsData => sync_integrations_data(&ss).await,
        MpApplicationJob::UpdateMediaTranslations(user_id, input) => {
            update_media_entity_translation(&ss, &user_id, input).await
        }
    };
    ryot_log!(trace, "Finished job {:?}", name);
    status.map_err(|e| Error::Failed(Arc::new(e.to_string().into())))
}

pub async fn perform_lp_application_job(
    information: LpApplicationJob,
    ss: Data<Arc<SupportingService>>,
) -> Result<(), Error> {
    let name = information.to_string();
    ryot_log!(trace, "Started job {:?}", information);
    let status = match information {
        LpApplicationJob::HandleEntityAddedToCollectionEvent(collection_to_entity_id) => {
            handle_entity_added_to_collection_event(&ss, collection_to_entity_id)
                .await
                .ok();
            event_operations::handle_entity_added_to_collection_event(collection_to_entity_id, &ss)
                .await
        }
        LpApplicationJob::HandleOnSeenComplete(id) => handle_on_seen_complete(&ss, id).await,
        LpApplicationJob::UpdateUserLastActivityPerformed(user_id, timestamp) => {
            update_user_last_activity_performed(&ss, user_id, timestamp).await
        }
        LpApplicationJob::HandleMetadataEligibleForSmartCollectionMoving(metadata_id) => {
            handle_metadata_eligible_for_smart_collection_moving(&ss, metadata_id).await
        }
    };
    ryot_log!(trace, "Finished job {:?}", name);
    status.map_err(|e| Error::Failed(Arc::new(e.to_string().into())))
}

pub async fn perform_single_application_job(
    information: SingleApplicationJob,
    ss: Data<Arc<SupportingService>>,
) -> Result<(), Error> {
    let name = information.to_string();
    ryot_log!(trace, "Started job {:?}", information);
    let status = match information {
        SingleApplicationJob::ProcessIntegrationWebhook(integration_slug, payload) => {
            process_integration_webhook(&ss, integration_slug, payload)
                .await
                .map(|_| ())
        }
    };
    ryot_log!(trace, "Finished job {:?}", name);
    status.map_err(|e| Error::Failed(Arc::new(e.to_string().into())))
}
