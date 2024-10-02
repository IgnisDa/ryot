use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use common_models::{BackgroundJob, SearchInput, StringIdObject};
use dependent_models::{
    CoreDetails, GenreDetails, MetadataGroupDetails, PersonDetails, SearchResults,
    UserMetadataDetails, UserMetadataGroupDetails, UserPersonDetails,
};
use media_models::{
    CommitMediaInput, CommitPersonInput, CreateCustomMetadataInput, CreateOrUpdateReviewInput,
    CreateReviewCommentInput, GenreDetailsInput, GenreListItem, GraphqlCalendarEvent,
    GraphqlMetadataDetails, GroupedCalendarEvent, MetadataGroupSearchInput,
    MetadataGroupSearchItem, MetadataGroupsListInput, MetadataListInput, MetadataPartialDetails,
    MetadataSearchInput, MetadataSearchItemResponse, PeopleListInput, PeopleSearchInput,
    PeopleSearchItem, ProgressUpdateInput, ProviderLanguageInformation, UpdateSeenItemInput,
    UserCalendarEventInput, UserUpcomingCalendarEventInput,
};
use miscellaneous_service::MiscellaneousService;
use traits::AuthProvider;

#[derive(Default)]
pub struct MiscellaneousQuery;

impl AuthProvider for MiscellaneousQuery {}

#[Object]
impl MiscellaneousQuery {
    /// Get some primary information about the service.
    async fn core_details(&self, gql_ctx: &Context<'_>) -> CoreDetails {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.core_details().await
    }

    /// Get partial details about a media present in the database.
    async fn metadata_partial_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: String,
    ) -> Result<MetadataPartialDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.metadata_partial_details(&metadata_id).await
    }

    /// Get details about a media present in the database.
    async fn metadata_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: String,
    ) -> Result<GraphqlMetadataDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.metadata_details(&metadata_id).await
    }

    /// Get details about a creator present in the database.
    async fn person_details(
        &self,
        gql_ctx: &Context<'_>,
        person_id: String,
    ) -> Result<PersonDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.person_details(person_id).await
    }

    /// Get details about a genre present in the database.
    async fn genre_details(
        &self,
        gql_ctx: &Context<'_>,
        input: GenreDetailsInput,
    ) -> Result<GenreDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.genre_details(input).await
    }

    /// Get details about a metadata group present in the database.
    async fn metadata_group_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_group_id: String,
    ) -> Result<MetadataGroupDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.metadata_group_details(metadata_group_id).await
    }

    /// Get all the media items related to a user for a specific media type.
    async fn metadata_list(
        &self,
        gql_ctx: &Context<'_>,
        input: MetadataListInput,
    ) -> Result<SearchResults<String>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.metadata_list(user_id, input).await
    }

    /// Search for a list of media for a given type.
    async fn metadata_search(
        &self,
        gql_ctx: &Context<'_>,
        input: MetadataSearchInput,
    ) -> Result<SearchResults<MetadataSearchItemResponse>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.metadata_search(&user_id, input).await
    }

    /// Get paginated list of genres.
    async fn genres_list(
        &self,
        gql_ctx: &Context<'_>,
        input: SearchInput,
    ) -> Result<SearchResults<GenreListItem>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.genres_list(input).await
    }

    /// Get paginated list of metadata groups.
    async fn metadata_groups_list(
        &self,
        gql_ctx: &Context<'_>,
        input: MetadataGroupsListInput,
    ) -> Result<SearchResults<String>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.metadata_groups_list(user_id, input).await
    }

    /// Get all languages supported by all the providers.
    async fn providers_language_information(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Vec<ProviderLanguageInformation> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.providers_language_information()
    }

    /// Get details that can be displayed to a user for a metadata group.
    async fn user_metadata_group_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_group_id: String,
    ) -> Result<UserMetadataGroupDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service
            .user_metadata_group_details(user_id, metadata_group_id)
            .await
    }

    /// Get details that can be displayed to a user for a media.
    async fn user_metadata_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: String,
    ) -> Result<UserMetadataDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.user_metadata_details(user_id, metadata_id).await
    }

    /// Get details that can be displayed to a user for a creator.
    async fn user_person_details(
        &self,
        gql_ctx: &Context<'_>,
        person_id: String,
    ) -> Result<UserPersonDetails> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.user_person_details(user_id, person_id).await
    }

    /// Get calendar events for a user between a given date range.
    async fn user_calendar_events(
        &self,
        gql_ctx: &Context<'_>,
        input: UserCalendarEventInput,
    ) -> Result<Vec<GroupedCalendarEvent>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.user_calendar_events(user_id, input).await
    }

    /// Get upcoming calendar events for the given filter.
    async fn user_upcoming_calendar_events(
        &self,
        gql_ctx: &Context<'_>,
        input: UserUpcomingCalendarEventInput,
    ) -> Result<Vec<GraphqlCalendarEvent>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.user_upcoming_calendar_events(user_id, input).await
    }

    /// Get paginated list of people.
    async fn people_list(
        &self,
        gql_ctx: &Context<'_>,
        input: PeopleListInput,
    ) -> Result<SearchResults<String>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.people_list(user_id, input).await
    }

    /// Search for a list of people from a given source.
    async fn people_search(
        &self,
        gql_ctx: &Context<'_>,
        input: PeopleSearchInput,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.people_search(&user_id, input).await
    }

    /// Search for a list of groups from a given source.
    async fn metadata_group_search(
        &self,
        gql_ctx: &Context<'_>,
        input: MetadataGroupSearchInput,
    ) -> Result<SearchResults<MetadataGroupSearchItem>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.metadata_group_search(&user_id, input).await
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
        service.create_or_update_review(&user_id, input).await
    }

    /// Delete a review if it belongs to the currently logged in user.
    async fn delete_review(&self, gql_ctx: &Context<'_>, review_id: String) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.delete_review(user_id, review_id).await
    }

    /// Delete a seen item from a user's history.
    async fn delete_seen_item(
        &self,
        gql_ctx: &Context<'_>,
        seen_id: String,
    ) -> Result<StringIdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.delete_seen_item(&user_id, seen_id).await
    }

    /// Associate a seen item with a review.
    async fn associate_seen_item_with_review(
        &self,
        gql_ctx: &Context<'_>,
        seen_id: String,
        review_id: String,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service
            .associate_seen_item_with_review(user_id, review_id, seen_id)
            .await
    }

    /// Create a custom media item.
    async fn create_custom_metadata(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateCustomMetadataInput,
    ) -> Result<StringIdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service
            .create_custom_metadata(user_id, input)
            .await
            .map(|m| StringIdObject { id: m.id })
    }

    /// Deploy job to update progress of media items in bulk. For seen items in progress,
    /// progress is updated only if it has actually changed.
    async fn deploy_bulk_progress_update(
        &self,
        gql_ctx: &Context<'_>,
        input: Vec<ProgressUpdateInput>,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.deploy_bulk_progress_update(user_id, input).await
    }

    /// Deploy a job to update a media item's metadata.
    async fn deploy_update_metadata_job(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: String,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.deploy_update_metadata_job(&metadata_id, true).await
    }

    /// Deploy a job to update a person's metadata.
    async fn deploy_update_person_job(
        &self,
        gql_ctx: &Context<'_>,
        person_id: String,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.deploy_update_person_job(person_id).await
    }

    /// Deploy a job to update a metadata group's details.
    async fn deploy_update_metadata_group_job(
        &self,
        gql_ctx: &Context<'_>,
        metadata_group_id: String,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service
            .deploy_update_metadata_group_job(metadata_group_id)
            .await
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
        service
            .merge_metadata(user_id, merge_from, merge_into)
            .await
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
        service.disassociate_metadata(user_id, metadata_id).await
    }

    /// Fetch details about a media and create a media item in the database.
    async fn commit_metadata(
        &self,
        gql_ctx: &Context<'_>,
        input: CommitMediaInput,
    ) -> Result<StringIdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service
            .commit_metadata(input)
            .await
            .map(|m| StringIdObject { id: m.id })
    }

    /// Fetches details about a person and creates a person item in the database.
    async fn commit_person(
        &self,
        gql_ctx: &Context<'_>,
        input: CommitPersonInput,
    ) -> Result<StringIdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.commit_person(input).await
    }

    /// Fetch details about a media group and create a media group item in the database.
    async fn commit_metadata_group(
        &self,
        gql_ctx: &Context<'_>,
        input: CommitMediaInput,
    ) -> Result<StringIdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.commit_metadata_group(input).await
    }

    /// Create, like or delete a comment on a review.
    async fn create_review_comment(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateReviewCommentInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.create_review_comment(user_id, input).await
    }

    /// Update the start/end date of a seen item.
    async fn update_seen_item(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateSeenItemInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.update_seen_item(user_id, input).await
    }

    /// Start a background job.
    async fn deploy_background_job(
        &self,
        gql_ctx: &Context<'_>,
        job_name: BackgroundJob,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.deploy_background_job(&user_id, job_name).await
    }

    /// Use this mutation to call a function that needs to be tested for implementation.
    /// It is only available in development mode.
    #[cfg(debug_assertions)]
    async fn development_mutation(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.development_mutation().await
    }
}
