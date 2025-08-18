use async_graphql::{Context, Object, Result};
use common_models::{ApplicationDateRange, UserAnalyticsInput};
use dependent_models::{CachedResponse, UserAnalytics};
use statistics_service::StatisticsService;
use traits::{AuthProvider, GraphqlResolverSvc};

#[derive(Default)]
pub struct StatisticsQueryResolver;

impl AuthProvider for StatisticsQueryResolver {}
impl GraphqlResolverSvc<StatisticsService> for StatisticsQueryResolver {}

#[Object]
impl StatisticsQueryResolver {
    /// Get the analytics parameters for the currently logged in user.
    async fn user_analytics_parameters(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<CachedResponse<ApplicationDateRange>> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.user_analytics_parameters(&user_id).await?)
    }

    /// Get the analytics for the currently logged in user.
    async fn user_analytics(
        &self,
        gql_ctx: &Context<'_>,
        input: UserAnalyticsInput,
    ) -> Result<CachedResponse<UserAnalytics>> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.user_analytics(&user_id, input).await?)
    }
}
