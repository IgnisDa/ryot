use std::sync::Arc;

use anyhow::Result;
use chrono::Utc;
use common_utils::ryot_log;
use database_models::{import_report, prelude::ImportReport};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, prelude::Expr};
use supporting_service::SupportingService;
use traits::TraceOk;

use crate::{
    access::revoke_invalid_access_tokens,
    cache::{expire_cache_keys, remove_cached_metadata_after_updates},
    calendar::{
        queue_notifications_for_released_media, queue_pending_reminders,
        recalculate_calendar_events,
    },
    cleanup::{put_entities_in_partial_state, remove_useless_data},
    collections::rebalance_collection_ranks,
    integrations::sync_integrations_data_to_owned_collection,
    monitoring::{
        update_all_monitored_metadata_and_notify_users,
        update_all_monitored_people_and_notify_users,
    },
    notifications::queue_notifications_for_outdated_seen_entries,
    summaries::regenerate_user_summaries,
    user::cleanup_user_and_metadata_association,
};

mod access;
mod cache;
mod calendar;
mod cleanup;
mod collections;
mod integrations;
mod monitoring;
mod notifications;
mod summaries;
mod user;

pub async fn perform_background_jobs(ss: &Arc<SupportingService>) -> Result<()> {
    ryot_log!(debug, "Starting background jobs...");

    ryot_log!(trace, "Checking for updates for monitored media");
    update_all_monitored_metadata_and_notify_users(ss)
        .await
        .trace_ok();
    ryot_log!(trace, "Checking for updates for monitored people");
    update_all_monitored_people_and_notify_users(ss)
        .await
        .trace_ok();
    ryot_log!(trace, "Checking and queuing any pending reminders");
    queue_pending_reminders(ss).await.trace_ok();
    ryot_log!(trace, "Recalculating calendar events");
    recalculate_calendar_events(ss).await.trace_ok();
    ryot_log!(trace, "Queuing notifications for released media");
    queue_notifications_for_released_media(ss).await.trace_ok();
    ryot_log!(trace, "Cleaning up user and metadata association");
    cleanup_user_and_metadata_association(ss).await.trace_ok();
    ryot_log!(trace, "Removing old user summaries and regenerating them");
    regenerate_user_summaries(ss).await.trace_ok();
    ryot_log!(trace, "Syncing integrations data to owned collection");
    sync_integrations_data_to_owned_collection(ss)
        .await
        .trace_ok();
    ryot_log!(trace, "Queueing notifications for outdated seen entries");
    queue_notifications_for_outdated_seen_entries(ss)
        .await
        .trace_ok();
    ryot_log!(trace, "Removing useless data");
    remove_useless_data(ss).await.trace_ok();
    ryot_log!(trace, "Removing cached metadata after metadata updates");
    remove_cached_metadata_after_updates(ss).await.trace_ok();
    ryot_log!(trace, "Putting entities in partial state");
    put_entities_in_partial_state(ss).await.trace_ok();
    // DEV: Invalid access tokens are revoked before being deleted, so we call this
    // function after removing useless data.
    ryot_log!(trace, "Revoking invalid access tokens");
    revoke_invalid_access_tokens(ss).await.trace_ok();
    ryot_log!(trace, "Rebalancing fragmented collection ranks");
    rebalance_collection_ranks(ss).await.trace_ok();
    ryot_log!(trace, "Expiring cache keys");
    expire_cache_keys(ss).await.trace_ok();

    ryot_log!(debug, "Completed background jobs...");
    Ok(())
}

pub async fn invalidate_import_jobs(ss: &Arc<SupportingService>) -> Result<()> {
    let result = ImportReport::update_many()
        .col_expr(import_report::Column::WasSuccess, Expr::value(false))
        .filter(import_report::Column::WasSuccess.is_null())
        .filter(import_report::Column::EstimatedFinishTime.lt(Utc::now()))
        .exec(&ss.db)
        .await?;
    ryot_log!(debug, "Invalidated {} import jobs", result.rows_affected);
    Ok(())
}
