use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use common_models::{MetadataGroupSearchInput, MetadataSearchInput, PeopleSearchInput};
use dependent_models::{
    CachedResponse, MetadataGroupSearchResponse, MetadataSearchResponse, PeopleSearchResponse,
    TrendingMetadataIdsResponse,
};
use media_models::MetadataLookupResponse;
use miscellaneous_service::MiscellaneousService;
use traits::AuthProvider;

#[derive(Default)]
pub struct SearchQuery;

impl AuthProvider for SearchQuery {}

#[Object]
impl SearchQuery {
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
