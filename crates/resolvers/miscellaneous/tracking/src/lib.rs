use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use common_models::StringIdObject;
use media_models::{
    GraphqlCalendarEvent, GroupedCalendarEvent, MetadataProgressUpdateInput, UpdateSeenItemInput,
    UserCalendarEventInput, UserUpcomingCalendarEventInput,
};
use miscellaneous_service::MiscellaneousService;
use traits::AuthProvider;

#[derive(Default)]
pub struct MiscellaneousTrackingQueryResolver;

impl AuthProvider for MiscellaneousTrackingQueryResolver {}

#[Object]
impl MiscellaneousTrackingQueryResolver {
    /// Get calendar events for a user between a given date range.
    async fn user_calendar_events(
        &self,
        gql_ctx: &Context<'_>,
        input: UserCalendarEventInput,
    ) -> Result<Vec<GroupedCalendarEvent>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.user_calendar_events(user_id, input).await?;
        Ok(response)
    }

    /// Get upcoming calendar events for the given filter.
    async fn user_upcoming_calendar_events(
        &self,
        gql_ctx: &Context<'_>,
        input: UserUpcomingCalendarEventInput,
    ) -> Result<Vec<GraphqlCalendarEvent>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service
            .user_upcoming_calendar_events(user_id, input)
            .await?;
        Ok(response)
    }
}

#[derive(Default)]
pub struct MiscellaneousTrackingMutationResolver;

impl AuthProvider for MiscellaneousTrackingMutationResolver {
    fn is_mutation(&self) -> bool {
        true
    }
}

#[Object]
impl MiscellaneousTrackingMutationResolver {
    /// Delete a seen item from a user's history.
    async fn delete_seen_item(
        &self,
        gql_ctx: &Context<'_>,
        seen_id: String,
    ) -> Result<StringIdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.delete_seen_item(&user_id, seen_id).await?;
        Ok(response)
    }

    /// Deploy job to update progress of media items in bulk. For seen items in progress,
    /// progress is updated only if it has actually changed.
    async fn deploy_bulk_metadata_progress_update(
        &self,
        gql_ctx: &Context<'_>,
        input: Vec<MetadataProgressUpdateInput>,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service
            .deploy_bulk_metadata_progress_update(user_id, input)
            .await?;
        Ok(response)
    }

    /// Update the attributes of a seen item.
    async fn update_seen_item(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateSeenItemInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.update_seen_item(user_id, input).await?;
        Ok(response)
    }
}
