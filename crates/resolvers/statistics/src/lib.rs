use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use common_models::{UserAnalytics, UserAnalyticsInput};
use statistics_service::StatisticsService;
use traits::AuthProvider;

#[derive(Default)]
pub struct StatisticsQuery;

impl AuthProvider for StatisticsQuery {}

#[Object]
impl StatisticsQuery {
    /// Get the analytics for the currently logged in user.
    async fn user_analytics(
        &self,
        gql_ctx: &Context<'_>,
        input: UserAnalyticsInput,
    ) -> Result<UserAnalytics> {
        let service = gql_ctx.data_unchecked::<Arc<StatisticsService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.user_analytics(&user_id, input).await
    }
}
