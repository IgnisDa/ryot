use std::sync::Arc;

use anyhow::Result;
use common_models::{ApplicationDateRange, UserAnalyticsInput};
use dependent_models::{CachedResponse, UserAnalytics};
use dependent_utils::calculate_user_activities_and_summary;
use supporting_service::SupportingService;

mod analytics_operations;
mod daily_activity_operations;

pub use crate::{
    analytics_operations::user_analytics,
    daily_activity_operations::{get_daily_user_activities, user_analytics_parameters},
};

pub struct StatisticsService(pub Arc<SupportingService>);

impl StatisticsService {
    pub async fn calculate_user_activities_and_summary(
        &self,
        user_id: &String,
        calculate_from_beginning: bool,
    ) -> Result<()> {
        calculate_user_activities_and_summary(user_id, &self.0, calculate_from_beginning).await
    }

    pub async fn user_analytics_parameters(
        &self,
        user_id: &String,
    ) -> Result<CachedResponse<ApplicationDateRange>> {
        user_analytics_parameters(&self.0, user_id).await
    }

    pub async fn user_analytics(
        &self,
        user_id: &String,
        input: UserAnalyticsInput,
    ) -> Result<CachedResponse<UserAnalytics>> {
        user_analytics(&self.0, user_id, input).await
    }
}
