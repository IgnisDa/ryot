use async_graphql::{Context, Object, Result};
use common_models::SearchInput;
use dependent_models::SearchResults;
use dependent_models::{
    CachedResponse, GenreDetails, MetadataGroupDetails, UserMetadataGroupDetails,
    UserMetadataGroupsListInput, UserMetadataGroupsListResponse,
};
use media_models::GenreDetailsInput;
use traits::GraphqlDependencyInjector;

#[derive(Default)]
pub struct MiscellaneousGroupingQueryResolver;

impl GraphqlDependencyInjector for MiscellaneousGroupingQueryResolver {}

#[Object]
impl MiscellaneousGroupingQueryResolver {
    /// Get details about a metadata group present in the database.
    async fn metadata_group_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_group_id: String,
    ) -> Result<CachedResponse<MetadataGroupDetails>> {
        let service = self.dependency(gql_ctx);
        Ok(dependent_details_utils::metadata_group_details(service, &metadata_group_id).await?)
    }

    /// Get paginated list of metadata groups.
    async fn user_metadata_groups_list(
        &self,
        gql_ctx: &Context<'_>,
        input: UserMetadataGroupsListInput,
    ) -> Result<CachedResponse<UserMetadataGroupsListResponse>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(
            dependent_entity_list_utils::user_metadata_groups_list(&user_id, service, input)
                .await?,
        )
    }

    /// Get details that can be displayed to a user for a metadata group.
    async fn user_metadata_group_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_group_id: String,
    ) -> Result<CachedResponse<UserMetadataGroupDetails>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(
            miscellaneous_entity_user_details_service::user_metadata_group_details(
                service,
                user_id,
                metadata_group_id,
            )
            .await?,
        )
    }

    /// Get details about a genre present in the database.
    async fn genre_details(
        &self,
        gql_ctx: &Context<'_>,
        input: GenreDetailsInput,
    ) -> Result<CachedResponse<GenreDetails>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(dependent_details_utils::genre_details(service, user_id, input).await?)
    }

    /// Get paginated list of genres for the user.
    async fn user_genres_list(
        &self,
        gql_ctx: &Context<'_>,
        input: Option<SearchInput>,
    ) -> Result<SearchResults<String>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(dependent_entity_list_utils::user_genres_list(service, user_id, input).await?)
    }
}
