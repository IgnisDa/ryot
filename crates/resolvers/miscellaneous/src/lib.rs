use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use common_models::{
    BackgroundJob, MetadataGroupSearchInput, MetadataSearchInput, PeopleSearchInput, SearchInput,
    StringIdObject,
};
use dependent_models::{
    CachedResponse, CoreDetails, GenreDetails, GraphqlPersonDetails, MetadataGroupDetails,
    MetadataGroupSearchResponse, MetadataSearchResponse, PeopleSearchResponse, SearchResults,
    TrendingMetadataIdsResponse, UserMetadataDetails, UserMetadataGroupDetails,
    UserMetadataGroupsListInput, UserMetadataGroupsListResponse, UserMetadataListInput,
    UserMetadataListResponse, UserPeopleListInput, UserPeopleListResponse, UserPersonDetails,
};
use enum_models::EntityLot;
use media_models::{
    CreateCustomMetadataInput, CreateOrUpdateReviewInput, CreateReviewCommentInput,
    GenreDetailsInput, GraphqlCalendarEvent, GraphqlMetadataDetails, GroupedCalendarEvent,
    MarkEntityAsPartialInput, MetadataLookupResponse, MetadataProgressUpdateInput,
    UpdateCustomMetadataInput, UpdateSeenItemInput, UserCalendarEventInput,
    UserUpcomingCalendarEventInput,
};
use miscellaneous_service::MiscellaneousService;
use traits::AuthProvider;
use uuid::Uuid;

#[derive(Default)]
pub struct MiscellaneousQuery;

impl AuthProvider for MiscellaneousQuery {}

#[Object]
impl MiscellaneousQuery {
    /// Get some primary information about the service.
    async fn core_details(&self, gql_ctx: &Context<'_>) -> Result<CoreDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let response = service.core_details().await?;
        Ok(response)
    }

    /// Get details about a media present in the database.
    async fn metadata_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: String,
        ensure_updated: Option<bool>,
    ) -> Result<GraphqlMetadataDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let response = service
            .metadata_details(&metadata_id, ensure_updated)
            .await?;
        Ok(response)
    }

    /// Get details about a creator present in the database.
    async fn person_details(
        &self,
        gql_ctx: &Context<'_>,
        person_id: String,
    ) -> Result<GraphqlPersonDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let response = service.person_details(person_id).await?;
        Ok(response)
    }

    /// Get details about a genre present in the database.
    async fn genre_details(
        &self,
        gql_ctx: &Context<'_>,
        input: GenreDetailsInput,
    ) -> Result<GenreDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.genre_details(user_id, input).await?;
        Ok(response)
    }

    /// Get details about a metadata group present in the database.
    async fn metadata_group_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_group_id: String,
    ) -> Result<MetadataGroupDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let response = service.metadata_group_details(metadata_group_id).await?;
        Ok(response)
    }

    /// Get all the media items related to a user for a specific media type.
    async fn user_metadata_list(
        &self,
        gql_ctx: &Context<'_>,
        input: UserMetadataListInput,
    ) -> Result<CachedResponse<UserMetadataListResponse>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.user_metadata_list(user_id, input).await?;
        Ok(response)
    }

    /// Search for a list of media for a given type.
    async fn metadata_search(
        &self,
        gql_ctx: &Context<'_>,
        input: MetadataSearchInput,
    ) -> Result<CachedResponse<MetadataSearchResponse>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.metadata_search(&user_id, input).await?;
        Ok(response)
    }

    /// Get paginated list of genres for the user.
    async fn user_genres_list(
        &self,
        gql_ctx: &Context<'_>,
        input: SearchInput,
    ) -> Result<SearchResults<String>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.user_genres_list(user_id, input).await?;
        Ok(response)
    }

    /// Get paginated list of metadata groups.
    async fn user_metadata_groups_list(
        &self,
        gql_ctx: &Context<'_>,
        input: UserMetadataGroupsListInput,
    ) -> Result<CachedResponse<UserMetadataGroupsListResponse>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.user_metadata_groups_list(user_id, input).await?;
        Ok(response)
    }

    /// Get details that can be displayed to a user for a metadata group.
    async fn user_metadata_group_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_group_id: String,
    ) -> Result<UserMetadataGroupDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service
            .user_metadata_group_details(user_id, metadata_group_id)
            .await?;
        Ok(response)
    }

    /// Get details that can be displayed to a user for a media.
    async fn user_metadata_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: String,
    ) -> Result<UserMetadataDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.user_metadata_details(user_id, metadata_id).await?;
        Ok(response)
    }

    /// Get details that can be displayed to a user for a creator.
    async fn user_person_details(
        &self,
        gql_ctx: &Context<'_>,
        person_id: String,
    ) -> Result<UserPersonDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.user_person_details(user_id, person_id).await?;
        Ok(response)
    }

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

    /// Get paginated list of people.
    async fn user_people_list(
        &self,
        gql_ctx: &Context<'_>,
        input: UserPeopleListInput,
    ) -> Result<CachedResponse<UserPeopleListResponse>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.user_people_list(user_id, input).await?;
        Ok(response)
    }

    /// Search for a list of people from a given source.
    async fn people_search(
        &self,
        gql_ctx: &Context<'_>,
        input: PeopleSearchInput,
    ) -> Result<CachedResponse<PeopleSearchResponse>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.people_search(&user_id, input).await?;
        Ok(response)
    }

    /// Search for a list of groups from a given source.
    async fn metadata_group_search(
        &self,
        gql_ctx: &Context<'_>,
        input: MetadataGroupSearchInput,
    ) -> Result<CachedResponse<MetadataGroupSearchResponse>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.metadata_group_search(&user_id, input).await?;
        Ok(response)
    }

    /// Get trending media items.
    async fn trending_metadata(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<TrendingMetadataIdsResponse> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let response = service.trending_metadata().await?;
        Ok(response)
    }

    /// Lookup metadata by title.
    async fn metadata_lookup(
        &self,
        gql_ctx: &Context<'_>,
        title: String,
    ) -> Result<CachedResponse<MetadataLookupResponse>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let response = service.metadata_lookup(title).await?;
        Ok(response)
    }
}

#[derive(Default)]
pub struct MiscellaneousMutation;

impl AuthProvider for MiscellaneousMutation {
    fn is_mutation(&self) -> bool {
        true
    }
}

#[Object]
impl MiscellaneousMutation {
    /// Create or update a review.
    async fn create_or_update_review(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateOrUpdateReviewInput,
    ) -> Result<StringIdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.create_or_update_review(&user_id, input).await?;
        Ok(response)
    }

    /// Delete a review if it belongs to the currently logged in user.
    async fn delete_review(&self, gql_ctx: &Context<'_>, review_id: String) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.delete_review(user_id, review_id).await?;
        Ok(response)
    }

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

    /// Create a custom media item.
    async fn create_custom_metadata(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateCustomMetadataInput,
    ) -> Result<StringIdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let metadata = service.create_custom_metadata(user_id, input).await?;
        Ok(StringIdObject { id: metadata.id })
    }

    /// Update custom metadata.
    async fn update_custom_metadata(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateCustomMetadataInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.update_custom_metadata(&user_id, input).await?;
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

    /// Deploy a job to update a media entity's metadata.
    async fn deploy_update_media_entity_job(
        &self,
        gql_ctx: &Context<'_>,
        entity_id: String,
        entity_lot: EntityLot,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let response = service
            .deploy_update_media_entity_job(entity_id, entity_lot)
            .await?;
        Ok(response)
    }

    /// Merge a media item into another. This will move all `seen`, `collection`
    /// and `review` associations with to the metadata.
    async fn merge_metadata(
        &self,
        gql_ctx: &Context<'_>,
        merge_from: String,
        merge_into: String,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service
            .merge_metadata(user_id, merge_from, merge_into)
            .await?;
        Ok(response)
    }

    /// Delete all history and reviews for a given media item and remove it from all
    /// collections for the user.
    async fn disassociate_metadata(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: String,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.disassociate_metadata(user_id, metadata_id).await?;
        Ok(response)
    }

    /// Create, like or delete a comment on a review.
    async fn create_review_comment(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateReviewCommentInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.create_review_comment(user_id, input).await?;
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

    /// Start a background job.
    async fn deploy_background_job(
        &self,
        gql_ctx: &Context<'_>,
        job_name: BackgroundJob,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.deploy_background_job(&user_id, job_name).await?;
        Ok(response)
    }

    /// Mark an entity as partial.
    async fn mark_entity_as_partial(
        &self,
        gql_ctx: &Context<'_>,
        input: MarkEntityAsPartialInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        self.user_id_from_ctx(gql_ctx).await?;
        let response = service.mark_entity_as_partial(input).await?;
        Ok(response)
    }

    /// Expire a cache key by its ID
    async fn expire_cache_key(&self, gql_ctx: &Context<'_>, cache_id: Uuid) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let response = service.expire_cache_key(cache_id).await?;
        Ok(response)
    }

    /// Use this mutation to call a function that needs to be tested for implementation.
    /// It is only available in development mode.
    #[cfg(debug_assertions)]
    async fn development_mutation(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let response = service.development_mutation().await?;
        Ok(response)
    }
}
