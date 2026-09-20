use async_graphql::{Context, Object, Result};
use common_models::{MetadataGroupSearchInput, PeopleSearchInput};
use dependent_models::{
    CachedResponse, MetadataGroupSearchResponse, MetadataSearchInput, MetadataSearchResponse,
    PeopleSearchResponse, TrendingMetadataIdsResponse,
};
use media_models::MetadataLookupResponse;
use traits::GraphqlDependencyInjector;

#[derive(Default)]
pub struct MiscellaneousSearchQueryResolver;

impl GraphqlDependencyInjector for MiscellaneousSearchQueryResolver {}

#[Object]
impl MiscellaneousSearchQueryResolver {
    /// Search for a list of media for a given type.
    async fn metadata_search(
        &self,
        gql_ctx: &Context<'_>,
        input: MetadataSearchInput,
    ) -> Result<CachedResponse<MetadataSearchResponse>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(miscellaneous_search_service::metadata_search(service, &user_id, input).await?)
    }

    /// Search for a list of people from a given source.
    async fn people_search(
        &self,
        gql_ctx: &Context<'_>,
        input: PeopleSearchInput,
    ) -> Result<CachedResponse<PeopleSearchResponse>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(miscellaneous_search_service::people_search(service, &user_id, input).await?)
    }

    /// Search for a list of groups from a given source.
    async fn metadata_group_search(
        &self,
        gql_ctx: &Context<'_>,
        input: MetadataGroupSearchInput,
    ) -> Result<CachedResponse<MetadataGroupSearchResponse>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(miscellaneous_search_service::metadata_group_search(service, &user_id, input).await?)
    }

    /// Get trending media items.
    async fn trending_metadata(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<TrendingMetadataIdsResponse> {
        let service = self.dependency(gql_ctx);
        Ok(miscellaneous_trending_and_events_service::trending_metadata(service).await?)
    }

    /// Lookup metadata by title.
    async fn metadata_lookup(
        &self,
        gql_ctx: &Context<'_>,
        title: String,
    ) -> Result<CachedResponse<MetadataLookupResponse>> {
        let service = self.dependency(gql_ctx);
        Ok(miscellaneous_lookup_service::metadata_lookup(service, title).await?)
    }
}
