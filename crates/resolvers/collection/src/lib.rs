use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use collection_service::CollectionService;
use common_models::{ChangeCollectionToEntityInput, StringIdObject};
use dependent_models::{CollectionContents, UserCollectionsListResponse};
use media_models::{CollectionContentsInput, CreateOrUpdateCollectionInput};
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
        name: Option<String>,
    ) -> Result<UserCollectionsListResponse> {
        let service = gql_ctx.data_unchecked::<Arc<CollectionService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.user_collections_list(&user_id, name).await
    }

    /// Get the contents of a collection and respect visibility.
    async fn collection_contents(
        &self,
        gql_ctx: &Context<'_>,
        input: CollectionContentsInput,
    ) -> Result<CollectionContents> {
        let service = gql_ctx.data_unchecked::<Arc<CollectionService>>();
        service.collection_contents(input).await
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

    /// Add a entity to a collection if it is not there, otherwise do nothing.
    async fn add_entity_to_collection(
        &self,
        gql_ctx: &Context<'_>,
        input: ChangeCollectionToEntityInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<CollectionService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.add_entity_to_collection(&user_id, input).await
    }

    /// Remove an entity from a collection if it is not there, otherwise do nothing.
    async fn remove_entity_from_collection(
        &self,
        gql_ctx: &Context<'_>,
        input: ChangeCollectionToEntityInput,
    ) -> Result<StringIdObject> {
        let service = gql_ctx.data_unchecked::<Arc<CollectionService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.remove_entity_from_collection(&user_id, input).await
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
