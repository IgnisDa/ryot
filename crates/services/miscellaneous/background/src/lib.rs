use std::sync::Arc;

use anyhow::Result;
use chrono::Utc;
use database_models::{import_report, prelude::ImportReport};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, prelude::Expr};
use supporting_service::SupportingService;
use traits::TraceOk;

use crate::{
    access::revoke_invalid_access_tokens,
    cache::{expire_cache_keys, remove_cached_metadata_after_updates},
    calendar::{
        notify_users_for_pending_reminders, notify_users_for_released_media,
        recalculate_calendar_events,
    },
    cleanup::{put_entities_in_partial_state, remove_useless_data},
    collections::rebalance_collection_ranks,
    integrations::sync_integrations_data_to_owned_collection,
    monitoring::{
        update_all_monitored_metadata_and_notify_users,
        update_all_monitored_people_and_notify_users,
    },
    notifications::send_notifications_for_outdated_seen_entries,
    summaries::regenerate_user_summaries,
};

pub use crate::user::cleanup_user_and_metadata_association;

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
    tracing::debug!("Starting background jobs...");

    tracing::debug!("Checking for updates for monitored media");
    update_all_monitored_metadata_and_notify_users(ss)
        .await
        .trace_ok();
    tracing::debug!("Checking for updates for monitored people");
    update_all_monitored_people_and_notify_users(ss)
        .await
        .trace_ok();
    tracing::debug!("Checking and queuing any pending reminders");
    notify_users_for_pending_reminders(ss).await.trace_ok();
    tracing::debug!("Recalculating calendar events");
    recalculate_calendar_events(ss).await.trace_ok();
    tracing::debug!("Queuing notifications for released media");
    notify_users_for_released_media(ss).await.trace_ok();
    tracing::debug!("Removing old user summaries and regenerating them");
    regenerate_user_summaries(ss).await.trace_ok();
    tracing::debug!("Syncing integrations data to owned collection");
    sync_integrations_data_to_owned_collection(ss)
        .await
        .trace_ok();
    tracing::debug!("Sending notifications for outdated seen entries");
    send_notifications_for_outdated_seen_entries(ss)
        .await
        .trace_ok();
    tracing::debug!("Removing useless data");
    remove_useless_data(ss).await.trace_ok();
    tracing::debug!("Removing cached metadata after metadata updates");
    remove_cached_metadata_after_updates(ss).await.trace_ok();
    tracing::debug!("Putting entities in partial state");
    put_entities_in_partial_state(ss).await.trace_ok();
    // DEV: Invalid access tokens are revoked before being deleted, so we call this
    // function after removing useless data.
    tracing::debug!("Revoking invalid access tokens");
    revoke_invalid_access_tokens(ss).await.trace_ok();
    tracing::debug!("Rebalancing fragmented collection ranks");
    rebalance_collection_ranks(ss).await.trace_ok();
    tracing::debug!("Expiring cache keys");
    expire_cache_keys(ss).await.trace_ok();

    tracing::debug!("Completed background jobs...");
    Ok(())
}

pub async fn invalidate_import_jobs(ss: &Arc<SupportingService>) -> Result<()> {
    let result = ImportReport::update_many()
        .col_expr(import_report::Column::WasSuccess, Expr::value(false))
        .filter(import_report::Column::WasSuccess.is_null())
        .filter(import_report::Column::EstimatedFinishTime.lt(Utc::now()))
        .exec(&ss.db)
        .await?;
    tracing::debug!("Invalidated {} import jobs", result.rows_affected);
    Ok(())
}
