use std::sync::Arc;

use anyhow::Result;
use database_models::user;
use database_utils::get_enabled_users_query;
use dependent_analytics_utils::recalculate_user_activities_and_summary;
use sea_orm::QuerySelect;
use supporting_service::SupportingService;

pub async fn regenerate_user_summaries(ss: &Arc<SupportingService>) -> Result<()> {
    let all_users = get_enabled_users_query()
        .select_only()
        .column(user::Column::Id)
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    for user_id in all_users {
        recalculate_user_activities_and_summary(&user_id, ss, false).await?;
    }
    Ok(())
}
