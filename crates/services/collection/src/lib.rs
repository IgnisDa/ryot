use std::sync::Arc;

use async_graphql::Result;
use common_models::{ChangeCollectionToEntityInput, StringIdObject};
use dependent_models::{
    CachedResponse, CollectionContentsInput, CollectionContentsResponse,
    CollectionRecommendationsInput, SearchResults, UserCollectionsListResponse,
};
use dependent_utils::{
    add_entity_to_collection, create_or_update_collection, remove_entity_from_collection,
    user_collections_list,
};
use media_models::CreateOrUpdateCollectionInput;
use supporting_service::SupportingService;
use uuid::Uuid;

mod content_operations;
mod event_operations;
mod management_operations;
mod recommendation_operations;

pub struct CollectionService(pub Arc<SupportingService>);

impl CollectionService {
    pub async fn user_collections_list(
        &self,
        user_id: &String,
    ) -> Result<CachedResponse<UserCollectionsListResponse>> {
        user_collections_list(user_id, &self.0).await
    }

    pub async fn collection_contents(
        &self,
        user_id: &String,
        input: CollectionContentsInput,
    ) -> Result<CachedResponse<CollectionContentsResponse>> {
        content_operations::collection_contents(self, user_id, input).await
    }

    pub async fn collection_recommendations(
        &self,
        user_id: &String,
        input: CollectionRecommendationsInput,
    ) -> Result<SearchResults<String>> {
        recommendation_operations::collection_recommendations(self, user_id, input).await
    }

    pub async fn create_or_update_collection(
        &self,
        user_id: &String,
        input: CreateOrUpdateCollectionInput,
    ) -> Result<StringIdObject> {
        create_or_update_collection(user_id, &self.0, input).await
    }

    pub async fn delete_collection(&self, user_id: String, name: &str) -> Result<bool> {
        management_operations::delete_collection(self, user_id, name).await
    }

    pub async fn add_entity_to_collection(
        &self,
        user_id: &String,
        input: ChangeCollectionToEntityInput,
    ) -> Result<bool> {
        add_entity_to_collection(user_id, input, &self.0).await
    }

    pub async fn remove_entity_from_collection(
        &self,
        user_id: &String,
        input: ChangeCollectionToEntityInput,
    ) -> Result<StringIdObject> {
        remove_entity_from_collection(user_id, input, &self.0).await
    }

    pub async fn handle_entity_added_to_collection_event(
        &self,
        collection_to_entity_id: Uuid,
    ) -> Result<()> {
        event_operations::handle_entity_added_to_collection_event(self, collection_to_entity_id)
            .await
    }
}
