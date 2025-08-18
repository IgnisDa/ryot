use async_graphql::{Context, Object, Result};
use common_models::SearchInput;
use dependent_models::SearchResults;
use dependent_models::{
    CachedResponse, GenreDetails, MetadataGroupDetails, UserMetadataGroupDetails,
    UserMetadataGroupsListInput, UserMetadataGroupsListResponse,
};
use media_models::GenreDetailsInput;
use miscellaneous_service::MiscellaneousService;
use traits::{AuthProvider, GraphqlResolverSvc};

#[derive(Default)]
pub struct MiscellaneousGroupingQueryResolver;

impl AuthProvider for MiscellaneousGroupingQueryResolver {}
impl GraphqlResolverSvc<MiscellaneousService> for MiscellaneousGroupingQueryResolver {}

#[Object]
impl MiscellaneousGroupingQueryResolver {
    /// Get details about a metadata group present in the database.
    async fn metadata_group_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_group_id: String,
    ) -> Result<MetadataGroupDetails> {
        let service = self.svc(gql_ctx);
        Ok(service.metadata_group_details(metadata_group_id).await?)
    }

    /// Get paginated list of metadata groups.
    async fn user_metadata_groups_list(
        &self,
        gql_ctx: &Context<'_>,
        input: UserMetadataGroupsListInput,
    ) -> Result<CachedResponse<UserMetadataGroupsListResponse>> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.user_metadata_groups_list(user_id, input).await?)
    }

    /// Get details that can be displayed to a user for a metadata group.
    async fn user_metadata_group_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_group_id: String,
    ) -> Result<UserMetadataGroupDetails> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service
            .user_metadata_group_details(user_id, metadata_group_id)
            .await?)
    }

    /// Get details about a genre present in the database.
    async fn genre_details(
        &self,
        gql_ctx: &Context<'_>,
        input: GenreDetailsInput,
    ) -> Result<GenreDetails> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.genre_details(user_id, input).await?)
    }

    /// Get paginated list of genres for the user.
    async fn user_genres_list(
        &self,
        gql_ctx: &Context<'_>,
        input: SearchInput,
    ) -> Result<SearchResults<String>> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.user_genres_list(user_id, input).await?)
    }
}
