use std::sync::Arc;

use anyhow::Result;
use chrono::{Duration, Utc};
use convert_case::{Case, Casing};
use database_models::{
    import_report,
    prelude::{ImportReport, Metadata, Seen},
    seen,
};
use dependent_utils::{is_server_key_validated, send_notification_for_user};
use enum_models::{SeenState, UserNotificationContent};
use sea_orm::{ColumnTrait, EntityTrait, ModelTrait, QueryFilter};
use sea_query::Expr;
use supporting_service::SupportingService;

pub async fn invalidate_import_jobs(ss: &Arc<SupportingService>) -> Result<()> {
    let result = ImportReport::update_many()
        .col_expr(import_report::Column::WasSuccess, Expr::value(false))
        .filter(import_report::Column::WasSuccess.is_null())
        .filter(import_report::Column::EstimatedFinishTime.lt(Utc::now()))
        .exec(&ss.db)
        .await?;
    common_utils::ryot_log!(debug, "Invalidated {} import jobs", result.rows_affected);
    Ok(())
}

pub async fn queue_notifications_for_outdated_seen_entries(
    ss: &Arc<SupportingService>,
) -> Result<()> {
    if !is_server_key_validated(ss).await? {
        return Ok(());
    }
    for state in [SeenState::InProgress, SeenState::OnAHold] {
        let days = match state {
            SeenState::InProgress => 7,
            SeenState::OnAHold => 14,
            _ => unreachable!(),
        };
        let threshold = Utc::now() - Duration::days(days);
        let seen_items = Seen::find()
            .filter(seen::Column::State.eq(state))
            .filter(seen::Column::LastUpdatedOn.lte(threshold))
            .all(&ss.db)
            .await?;
        for seen_item in seen_items {
            let Some(metadata) = seen_item.find_related(Metadata).one(&ss.db).await? else {
                continue;
            };
            let state = seen_item
                .state
                .to_string()
                .to_case(Case::Title)
                .to_case(Case::Lower);
            send_notification_for_user(
                &seen_item.user_id,
                ss,
                UserNotificationContent::OutdatedSeenEntries {
                    seen_state: state,
                    days_threshold: days,
                    entity_title: metadata.title,
                    entity_lot: EntityLot::Metadata,
                    last_updated_on: seen_item.last_updated_on.date_naive(),
                },
            )
            .await?;
        }
    }
    Ok(())
}
