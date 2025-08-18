use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use common_models::{ApplicationDateRange, UserAnalyticsInput};
use dependent_models::{CachedResponse, UserAnalytics};
use statistics_service::StatisticsService;
use traits::AuthProvider;

#[derive(Default)]
pub struct StatisticsQueryResolver;

impl AuthProvider for StatisticsQueryResolver {}

#[Object]
impl StatisticsQueryResolver {
    /// Get the analytics parameters for the currently logged in user.
    async fn user_analytics_parameters(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<CachedResponse<ApplicationDateRange>> {
        let service = gql_ctx.data_unchecked::<Arc<StatisticsService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.user_analytics_parameters(&user_id).await?;
        Ok(response)
    }

    /// Get the analytics for the currently logged in user.
    async fn user_analytics(
        &self,
        gql_ctx: &Context<'_>,
        input: UserAnalyticsInput,
    ) -> Result<CachedResponse<UserAnalytics>> {
        let service = gql_ctx.data_unchecked::<Arc<StatisticsService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.user_analytics(&user_id, input).await?;
        Ok(response)
    }
}
