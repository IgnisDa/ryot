use async_graphql::{Context, Object, Result};
use collection_service::CollectionService;
use common_models::{
    ChangeCollectionToEntitiesInput, ReorderCollectionEntityInput, StringIdObject,
};
use dependent_models::{
    CachedResponse, CollectionContentsInput, CollectionContentsResponse,
    CollectionRecommendationsInput, SearchResults, UserCollectionsListResponse,
};
use media_models::CreateOrUpdateCollectionInput;
use traits::{AuthProvider, GraphqlResolverSvc};

#[derive(Default)]
pub struct CollectionQueryResolver;

impl AuthProvider for CollectionQueryResolver {}
impl GraphqlResolverSvc<CollectionService> for CollectionQueryResolver {}

#[Object]
impl CollectionQueryResolver {
    /// Get all collections for the currently logged in user.
    async fn user_collections_list(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<CachedResponse<UserCollectionsListResponse>> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.user_collections_list(&user_id).await?)
    }

    /// Get the contents of a collection and respect visibility.
    async fn collection_contents(
        &self,
        gql_ctx: &Context<'_>,
        input: CollectionContentsInput,
    ) -> Result<CachedResponse<CollectionContentsResponse>> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.collection_contents(&user_id, input).await?)
    }

    /// Get recommendations for a collection.
    async fn collection_recommendations(
        &self,
        gql_ctx: &Context<'_>,
        input: CollectionRecommendationsInput,
    ) -> Result<SearchResults<String>> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.collection_recommendations(&user_id, input).await?)
    }
}

#[derive(Default)]
pub struct CollectionMutationResolver;

impl AuthProvider for CollectionMutationResolver {
    fn is_mutation(&self) -> bool {
        true
    }
}
impl GraphqlResolverSvc<CollectionService> for CollectionMutationResolver {}

#[Object]
impl CollectionMutationResolver {
    /// Create a new collection for the logged in user or edit details of an existing one.
    async fn create_or_update_collection(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateOrUpdateCollectionInput,
    ) -> Result<StringIdObject> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.create_or_update_collection(&user_id, input).await?)
    }

    /// Deploy a background job to add entities to a collection.
    async fn deploy_add_entities_to_collection_job(
        &self,
        gql_ctx: &Context<'_>,
        input: ChangeCollectionToEntitiesInput,
    ) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service
            .deploy_add_entities_to_collection_job(&user_id, input)
            .await?)
    }

    /// Deploy a background job to remove entities from a collection.
    async fn deploy_remove_entities_from_collection_job(
        &self,
        gql_ctx: &Context<'_>,
        input: ChangeCollectionToEntitiesInput,
    ) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service
            .deploy_remove_entities_from_collection_job(&user_id, input)
            .await?)
    }

    /// Delete a collection.
    async fn delete_collection(
        &self,
        gql_ctx: &Context<'_>,
        collection_name: String,
    ) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.delete_collection(user_id, &collection_name).await?)
    }

    /// Reorder an entity within a collection.
    async fn reorder_collection_entity(
        &self,
        gql_ctx: &Context<'_>,
        input: ReorderCollectionEntityInput,
    ) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.reorder_collection_entity(&user_id, input).await?)
    }
}
