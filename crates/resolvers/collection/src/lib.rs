use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use collection_service::CollectionService;
use common_models::{ChangeCollectionToEntitiesInput, StringIdObject};
use dependent_models::{
    CachedResponse, CollectionContentsInput, CollectionContentsResponse,
    CollectionRecommendationsInput, SearchResults, UserCollectionsListResponse,
};
use media_models::CreateOrUpdateCollectionInput;
use traits::AuthProvider;

#[derive(Default)]
pub struct CollectionQuery;

impl AuthProvider for CollectionQuery {}

#[Object]
impl CollectionQuery {
    /// Get all collections for the currently logged in user.
    async fn user_collections_list(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<CachedResponse<UserCollectionsListResponse>> {
        let service = gql_ctx.data_unchecked::<Arc<CollectionService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.user_collections_list(&user_id).await
    }

    /// Get the contents of a collection and respect visibility.
    async fn collection_contents(
        &self,
        gql_ctx: &Context<'_>,
        input: CollectionContentsInput,
    ) -> Result<CachedResponse<CollectionContentsResponse>> {
        let service = gql_ctx.data_unchecked::<Arc<CollectionService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.collection_contents(&user_id, input).await
    }

    /// Get recommendations for a collection.
    async fn collection_recommendations(
        &self,
        gql_ctx: &Context<'_>,
        input: CollectionRecommendationsInput,
    ) -> Result<SearchResults<String>> {
        let service = gql_ctx.data_unchecked::<Arc<CollectionService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.collection_recommendations(&user_id, input).await
    }
}

#[derive(Default)]
pub struct CollectionMutation;

impl AuthProvider for CollectionMutation {
    fn is_mutation(&self) -> bool {
        true
    }
}

#[Object]
impl CollectionMutation {
    /// Create a new collection for the logged in user or edit details of an existing one.
    async fn create_or_update_collection(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateOrUpdateCollectionInput,
    ) -> Result<StringIdObject> {
        let service = gql_ctx.data_unchecked::<Arc<CollectionService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.create_or_update_collection(&user_id, input).await
    }

    /// Add entities to a collection if they are not there, otherwise do nothing.
    async fn add_entities_to_collection(
        &self,
        gql_ctx: &Context<'_>,
        input: ChangeCollectionToEntitiesInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<CollectionService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.add_entities_to_collection(&user_id, input).await
    }

    /// Remove entities from a collection if they are there, otherwise do nothing.
    async fn remove_entities_from_collection(
        &self,
        gql_ctx: &Context<'_>,
        input: ChangeCollectionToEntitiesInput,
    ) -> Result<StringIdObject> {
        let service = gql_ctx.data_unchecked::<Arc<CollectionService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service
            .remove_entities_from_collection(&user_id, input)
            .await
    }

    /// Delete a collection.
    async fn delete_collection(
        &self,
        gql_ctx: &Context<'_>,
        collection_name: String,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<CollectionService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.delete_collection(user_id, &collection_name).await
    }
}
