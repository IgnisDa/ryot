use async_graphql::{Context, Object, Result};
use collection_service::{
    content_operations, deploy_add_entities_to_collection_job,
    deploy_remove_entities_from_collection_job, management_operations, recommendation_operations,
};
use common_models::{
    ChangeCollectionToEntitiesInput, ReorderCollectionEntityInput, StringIdObject,
};
use dependent_collection_utils::{create_or_update_collection, reorder_collection_entity};
use dependent_entity_list_utils::user_collections_list;
use dependent_models::{
    CachedResponse, CollectionContentsInput, CollectionContentsResponse,
    CollectionRecommendationsInput, SearchResults, UserCollectionsListResponse,
};
use media_models::CreateOrUpdateCollectionInput;
use traits::GraphqlDependencyInjector;

#[derive(Default)]
pub struct CollectionQueryResolver;

impl GraphqlDependencyInjector for CollectionQueryResolver {}

#[Object]
impl CollectionQueryResolver {
    /// Get all collections for the currently logged in user.
    async fn user_collections_list(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<CachedResponse<UserCollectionsListResponse>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(user_collections_list(&user_id, service).await?)
    }

    /// Get the contents of a collection and respect visibility.
    async fn collection_contents(
        &self,
        gql_ctx: &Context<'_>,
        input: CollectionContentsInput,
    ) -> Result<CachedResponse<CollectionContentsResponse>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(content_operations::collection_contents(&user_id, input, service).await?)
    }

    /// Get recommendations for a collection.
    async fn collection_recommendations(
        &self,
        gql_ctx: &Context<'_>,
        input: CollectionRecommendationsInput,
    ) -> Result<SearchResults<String>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(recommendation_operations::collection_recommendations(&user_id, input, service).await?)
    }
}

#[derive(Default)]
pub struct CollectionMutationResolver;

impl GraphqlDependencyInjector for CollectionMutationResolver {
    fn is_mutation(&self) -> bool {
        true
    }
}

#[Object]
impl CollectionMutationResolver {
    /// Create a new collection for the logged in user or edit details of an existing one.
    async fn create_or_update_collection(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateOrUpdateCollectionInput,
    ) -> Result<StringIdObject> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(create_or_update_collection(&user_id, service, input).await?)
    }

    /// Delete a collection.
    async fn delete_collection(
        &self,
        gql_ctx: &Context<'_>,
        collection_name: String,
    ) -> Result<bool> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(management_operations::delete_collection(&user_id, &collection_name, service).await?)
    }

    /// Reorder an entity within a collection.
    async fn reorder_collection_entity(
        &self,
        gql_ctx: &Context<'_>,
        input: ReorderCollectionEntityInput,
    ) -> Result<bool> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(reorder_collection_entity(&user_id, input, service).await?)
    }

    /// Deploy a background job to add entities to a collection.
    async fn deploy_add_entities_to_collection_job(
        &self,
        gql_ctx: &Context<'_>,
        input: ChangeCollectionToEntitiesInput,
    ) -> Result<bool> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(deploy_add_entities_to_collection_job(service, user_id, input).await?)
    }

    /// Deploy a background job to remove entities from a collection.
    async fn deploy_remove_entities_from_collection_job(
        &self,
        gql_ctx: &Context<'_>,
        input: ChangeCollectionToEntitiesInput,
    ) -> Result<bool> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(deploy_remove_entities_from_collection_job(service, user_id, input).await?)
    }
}
