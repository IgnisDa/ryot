use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use common_models::SearchInput;
use dependent_models::SearchResults;
use dependent_models::{
    CachedResponse, GenreDetails, MetadataGroupDetails, UserMetadataGroupDetails,
    UserMetadataGroupsListInput, UserMetadataGroupsListResponse,
};
use media_models::GenreDetailsInput;
use miscellaneous_service::MiscellaneousService;
use traits::AuthProvider;

#[derive(Default)]
pub struct GroupingQuery;

impl AuthProvider for GroupingQuery {}

#[Object]
impl GroupingQuery {
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
}
