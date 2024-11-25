use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use common_models::DateRangeInput;
use dependent_models::{DailyUserActivitiesResponse, FitnessAnalytics};
use media_models::{DailyUserActivitiesInput, DailyUserActivityItem};
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
        service.daily_user_activities(&user_id, input).await
    }

    /// Get a summary of all the media items that have been consumed by this user.
    async fn latest_user_summary(&self, gql_ctx: &Context<'_>) -> Result<DailyUserActivityItem> {
        let service = gql_ctx.data_unchecked::<Arc<StatisticsService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.latest_user_summary(&user_id).await
    }

    /// Get the fitness analytics for the currently logged in user.
    async fn fitness_analytics(
        &self,
        gql_ctx: &Context<'_>,
        input: DateRangeInput,
    ) -> Result<FitnessAnalytics> {
        let service = gql_ctx.data_unchecked::<Arc<StatisticsService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.fitness_analytics(&user_id, input).await
    }
}
