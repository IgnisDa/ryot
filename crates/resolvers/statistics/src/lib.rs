use async_graphql::{Context, Object, Result};
use common_models::{ApplicationDateRange, UserAnalyticsInput};
use dependent_models::{CachedResponse, UserAnalytics};
use statistics_service::{user_analytics, user_analytics_parameters};
use traits::{AuthProvider, GraphqlDependencyInjector};

#[derive(Default)]
pub struct StatisticsQueryResolver;

impl AuthProvider for StatisticsQueryResolver {}
impl GraphqlDependencyInjector for StatisticsQueryResolver {}

#[Object]
impl StatisticsQueryResolver {
    /// Get the analytics parameters for the currently logged in user.
    async fn user_analytics_parameters(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<CachedResponse<ApplicationDateRange>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(user_analytics_parameters(service, &user_id).await?)
    }

    /// Get the analytics for the currently logged in user.
    async fn user_analytics(
        &self,
        gql_ctx: &Context<'_>,
        input: UserAnalyticsInput,
    ) -> Result<CachedResponse<UserAnalytics>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(user_analytics(service, &user_id, input).await?)
    }
}
