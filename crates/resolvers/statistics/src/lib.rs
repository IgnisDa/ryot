use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use dependent_models::DailyUserActivitiesResponse;
use media_models::DailyUserActivitiesInput;
use statistics_service::StatisticsService;
use traits::AuthProvider;

#[derive(Default)]
pub struct StatisticsQuery;

impl AuthProvider for StatisticsQuery {}

#[Object]
impl StatisticsQuery {
    /// Get daily user activities for the currently logged in user.
    async fn daily_user_activities(
        &self,
        gql_ctx: &Context<'_>,
        input: DailyUserActivitiesInput,
    ) -> Result<DailyUserActivitiesResponse> {
        let service = gql_ctx.data_unchecked::<Arc<StatisticsService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.daily_user_activities(user_id, input).await
    }
}
