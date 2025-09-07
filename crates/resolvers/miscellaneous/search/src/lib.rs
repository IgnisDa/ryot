use async_graphql::{Context, Object, Result};
use common_models::{MetadataGroupSearchInput, PeopleSearchInput};
use dependent_models::{
    CachedResponse, MetadataGroupSearchResponse, MetadataSearchInput, MetadataSearchResponse,
    PeopleSearchResponse, TrendingMetadataIdsResponse,
};
use media_models::MetadataLookupResponse;
use miscellaneous_service::MiscellaneousService;
use traits::{AuthProvider, GraphqlResolverSvc};

#[derive(Default)]
pub struct MiscellaneousSearchQueryResolver;

impl AuthProvider for MiscellaneousSearchQueryResolver {}
impl GraphqlResolverSvc<MiscellaneousService> for MiscellaneousSearchQueryResolver {}

#[Object]
impl MiscellaneousSearchQueryResolver {
    /// Search for a list of media for a given type.
    async fn metadata_search(
        &self,
        gql_ctx: &Context<'_>,
        input: MetadataSearchInput,
    ) -> Result<CachedResponse<MetadataSearchResponse>> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.metadata_search(&user_id, input).await?)
    }

    /// Search for a list of people from a given source.
    async fn people_search(
        &self,
        gql_ctx: &Context<'_>,
        input: PeopleSearchInput,
    ) -> Result<CachedResponse<PeopleSearchResponse>> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.people_search(&user_id, input).await?)
    }

    /// Search for a list of groups from a given source.
    async fn metadata_group_search(
        &self,
        gql_ctx: &Context<'_>,
        input: MetadataGroupSearchInput,
    ) -> Result<CachedResponse<MetadataGroupSearchResponse>> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.metadata_group_search(&user_id, input).await?)
    }

    /// Get trending media items.
    async fn trending_metadata(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<TrendingMetadataIdsResponse> {
        let service = self.svc(gql_ctx);
        Ok(service.trending_metadata().await?)
    }

    /// Lookup metadata by title.
    async fn metadata_lookup(
        &self,
        gql_ctx: &Context<'_>,
        title: String,
    ) -> Result<CachedResponse<MetadataLookupResponse>> {
        let service = self.svc(gql_ctx);
        Ok(service.metadata_lookup(title).await?)
    }
}
