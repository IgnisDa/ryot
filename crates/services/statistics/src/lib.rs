use std::sync::Arc;

use anyhow::Result;
use dependent_analytics_utils::calculate_user_activities_and_summary;
use supporting_service::SupportingService;

mod analytics_operations;
mod daily_activity_operations;

pub use crate::{
    analytics_operations::user_analytics,
    daily_activity_operations::{get_daily_user_activities, user_analytics_parameters},
};

pub async fn calculate_user_activities_and_summary_for_user(
    ss: &Arc<SupportingService>,
    user_id: &String,
    calculate_from_beginning: bool,
) -> Result<()> {
    calculate_user_activities_and_summary(user_id, ss, calculate_from_beginning).await
}
