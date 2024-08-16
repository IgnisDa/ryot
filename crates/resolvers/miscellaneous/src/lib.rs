use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use common_models::{BackgroundJob, ChangeCollectionToEntityInput, SearchInput, StringIdObject};
use database_models::{integration, notification_platform, user, user_summary};
use dependent_models::{
    CollectionContents, CoreDetails, GenreDetails, MetadataGroupDetails, PersonDetails,
    SearchResults, UserDetailsResult, UserMetadataDetails, UserMetadataGroupDetails,
    UserPersonDetails,
};
use media_models::{
    AuthUserInput, CollectionContentsInput, CollectionItem, CommitMediaInput, CommitPersonInput,
    CreateCustomMetadataInput, CreateOrUpdateCollectionInput, CreateReviewCommentInput,
    CreateUserIntegrationInput, CreateUserNotificationPlatformInput, GenreDetailsInput,
    GenreListItem, GraphqlCalendarEvent, GraphqlMetadataDetails, GroupedCalendarEvent, LoginResult,
    MetadataGroupSearchInput, MetadataGroupSearchItem, MetadataGroupsListInput, MetadataListInput,
    MetadataPartialDetails, MetadataSearchInput, MetadataSearchItemResponse, OidcTokenOutput,
    PeopleListInput, PeopleSearchInput, PeopleSearchItem, PostReviewInput, ProgressUpdateInput,
    ProviderLanguageInformation, RegisterResult, RegisterUserInput, UpdateSeenItemInput,
    UpdateUserInput, UpdateUserIntegrationInput, UpdateUserNotificationPlatformInput,
    UpdateUserPreferenceInput, UserCalendarEventInput, UserUpcomingCalendarEventInput,
};
use miscellaneous_service::MiscellaneousService;
use traits::AuthProvider;
use user_models::UserPreferences;

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

    /// Get all collections for the currently logged in user.
    async fn user_collections_list(
        &self,
        gql_ctx: &Context<'_>,
        name: Option<String>,
    ) -> Result<Vec<CollectionItem>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.user_collections_list(&user_id, name).await
    }

    /// Get the contents of a collection and respect visibility.
    async fn collection_contents(
        &self,
        gql_ctx: &Context<'_>,
        input: CollectionContentsInput,
    ) -> Result<CollectionContents> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.collection_contents(input).await
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

    /// Get a summary of all the media items that have been consumed by this user.
    async fn latest_user_summary(&self, gql_ctx: &Context<'_>) -> Result<user_summary::Model> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.latest_user_summary(&user_id).await
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

    /// Get a user's preferences.
    async fn user_preferences(&self, gql_ctx: &Context<'_>) -> Result<UserPreferences> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.user_preferences(&user_id).await
    }

    /// Get details about all the users in the service.
    async fn users_list(
        &self,
        gql_ctx: &Context<'_>,
        query: Option<String>,
    ) -> Result<Vec<user::Model>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.users_list(query).await
    }

    /// Get details about the currently logged in user.
    async fn user_details(&self, gql_ctx: &Context<'_>) -> Result<UserDetailsResult> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let token = self.user_auth_token_from_ctx(gql_ctx)?;
        service.user_details(&token).await
    }

    /// Get all the integrations for the currently logged in user.
    async fn user_integrations(&self, gql_ctx: &Context<'_>) -> Result<Vec<integration::Model>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.user_integrations(&user_id).await
    }

    /// Get all the notification platforms for the currently logged in user.
    async fn user_notification_platforms(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<Vec<notification_platform::Model>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.user_notification_platforms(&user_id).await
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

    /// Get an authorization URL using the configured OIDC client.
    async fn get_oidc_redirect_url(&self, gql_ctx: &Context<'_>) -> Result<String> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.get_oidc_redirect_url().await
    }

    /// Get an access token using the configured OIDC client.
    async fn get_oidc_token(&self, gql_ctx: &Context<'_>, code: String) -> Result<OidcTokenOutput> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.get_oidc_token(code).await
    }

    /// Get user by OIDC issuer ID.
    async fn user_by_oidc_issuer_id(
        &self,
        gql_ctx: &Context<'_>,
        oidc_issuer_id: String,
    ) -> Result<Option<String>> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.user_by_oidc_issuer_id(oidc_issuer_id).await
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
    async fn post_review(
        &self,
        gql_ctx: &Context<'_>,
        input: PostReviewInput,
    ) -> Result<StringIdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.post_review(&user_id, input).await
    }

    /// Delete a review if it belongs to the currently logged in user.
    async fn delete_review(&self, gql_ctx: &Context<'_>, review_id: String) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.delete_review(user_id, review_id).await
    }

    /// Create a new collection for the logged in user or edit details of an existing one.
    async fn create_or_update_collection(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateOrUpdateCollectionInput,
    ) -> Result<StringIdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.create_or_update_collection(&user_id, input).await
    }

    /// Add a entity to a collection if it is not there, otherwise do nothing.
    async fn add_entity_to_collection(
        &self,
        gql_ctx: &Context<'_>,
        input: ChangeCollectionToEntityInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.add_entity_to_collection(&user_id, input).await
    }

    /// Remove an entity from a collection if it is not there, otherwise do nothing.
    async fn remove_entity_from_collection(
        &self,
        gql_ctx: &Context<'_>,
        input: ChangeCollectionToEntityInput,
    ) -> Result<StringIdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.remove_entity_from_collection(&user_id, input).await
    }

    /// Delete a collection.
    async fn delete_collection(
        &self,
        gql_ctx: &Context<'_>,
        collection_name: String,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.delete_collection(user_id, &collection_name).await
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

    /// Create a new user for the service. Also set their `lot` as admin if
    /// they are the first user.
    async fn register_user(
        &self,
        gql_ctx: &Context<'_>,
        input: RegisterUserInput,
    ) -> Result<RegisterResult> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.register_user(input).await
    }

    /// Login a user using their username and password and return an auth token.
    async fn login_user(&self, gql_ctx: &Context<'_>, input: AuthUserInput) -> Result<LoginResult> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        service.login_user(input).await
    }

    /// Update a user's profile details.
    async fn update_user(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateUserInput,
    ) -> Result<StringIdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await.ok();
        service.update_user(user_id, input).await
    }

    /// Change a user's preferences.
    async fn update_user_preference(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateUserPreferenceInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.update_user_preference(user_id, input).await
    }

    /// Create an integration for the currently logged in user.
    async fn create_user_integration(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateUserIntegrationInput,
    ) -> Result<StringIdObject> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.create_user_integration(user_id, input).await
    }

    /// Update an integration for the currently logged in user.
    async fn update_user_integration(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateUserIntegrationInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.update_user_integration(user_id, input).await
    }

    /// Delete an integration for the currently logged in user.
    async fn delete_user_integration(
        &self,
        gql_ctx: &Context<'_>,
        integration_id: String,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service
            .delete_user_integration(user_id, integration_id)
            .await
    }

    /// Add a notification platform for the currently logged in user.
    async fn create_user_notification_platform(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateUserNotificationPlatformInput,
    ) -> Result<String> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service
            .create_user_notification_platform(user_id, input)
            .await
    }

    /// Edit a notification platform for the currently logged in user.
    async fn update_user_notification_platform(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateUserNotificationPlatformInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service
            .update_user_notification_platform(user_id, input)
            .await
    }

    /// Delete a notification platform for the currently logged in user.
    async fn delete_user_notification_platform(
        &self,
        gql_ctx: &Context<'_>,
        notification_id: String,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service
            .delete_user_notification_platform(user_id, notification_id)
            .await
    }

    /// Test all notification platforms for the currently logged in user.
    async fn test_user_notification_platforms(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.test_user_notification_platforms(&user_id).await
    }

    /// Delete a user. The account making the user must an `Admin`.
    async fn delete_user(&self, gql_ctx: &Context<'_>, to_delete_user_id: String) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.admin_account_guard(&user_id).await?;
        service.delete_user(to_delete_user_id).await
    }

    /// Generate an auth token without any expiry.
    async fn generate_auth_token(&self, gql_ctx: &Context<'_>) -> Result<String> {
        let service = gql_ctx.data_unchecked::<Arc<MiscellaneousService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.generate_auth_token(user_id).await
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
