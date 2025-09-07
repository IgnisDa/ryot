use std::sync::Arc;

use anyhow::Result;
use background_models::{ApplicationJob, HpApplicationJob};
use common_models::{
    ChangeCollectionToEntitiesInput, ReorderCollectionEntityInput, StringIdObject,
};
use dependent_collection_utils::{
    add_entities_to_collection, create_or_update_collection, remove_entities_from_collection,
    reorder_collection_entity,
};
use dependent_entity_list_utils::user_collections_list;
use dependent_models::{
    CachedResponse, CollectionContentsInput, CollectionContentsResponse,
    CollectionRecommendationsInput, SearchResults, UserCollectionsListResponse,
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
        content_operations::collection_contents(user_id, input, &self.0).await
    }

    pub async fn collection_recommendations(
        &self,
        user_id: &String,
        input: CollectionRecommendationsInput,
    ) -> Result<SearchResults<String>> {
        recommendation_operations::collection_recommendations(user_id, input, &self.0).await
    }

    pub async fn create_or_update_collection(
        &self,
        user_id: &String,
        input: CreateOrUpdateCollectionInput,
    ) -> Result<StringIdObject> {
        create_or_update_collection(user_id, &self.0, input).await
    }

    pub async fn delete_collection(&self, user_id: String, name: &str) -> Result<bool> {
        management_operations::delete_collection(&user_id, name, &self.0).await
    }

    pub async fn add_entities_to_collection(
        &self,
        user_id: &String,
        input: ChangeCollectionToEntitiesInput,
    ) -> Result<bool> {
        add_entities_to_collection(user_id, input, &self.0).await
    }

    pub async fn remove_entities_from_collection(
        &self,
        user_id: &String,
        input: ChangeCollectionToEntitiesInput,
    ) -> Result<bool> {
        remove_entities_from_collection(user_id, input, &self.0).await
    }

    pub async fn reorder_collection_entity(
        &self,
        user_id: &String,
        input: ReorderCollectionEntityInput,
    ) -> Result<bool> {
        reorder_collection_entity(user_id, input, &self.0).await
    }

    pub async fn deploy_add_entities_to_collection_job(
        &self,
        user_id: &String,
        input: ChangeCollectionToEntitiesInput,
    ) -> Result<bool> {
        self.0
            .perform_application_job(ApplicationJob::Hp(
                HpApplicationJob::AddEntitiesToCollection(user_id.to_owned(), input),
            ))
            .await?;
        Ok(true)
    }

    pub async fn deploy_remove_entities_from_collection_job(
        &self,
        user_id: &String,
        input: ChangeCollectionToEntitiesInput,
    ) -> Result<bool> {
        self.0
            .perform_application_job(ApplicationJob::Hp(
                HpApplicationJob::RemoveEntitiesFromCollection(user_id.to_owned(), input),
            ))
            .await?;
        Ok(true)
    }

    pub async fn handle_entity_added_to_collection_event(
        &self,
        collection_to_entity_id: Uuid,
    ) -> Result<()> {
        event_operations::handle_entity_added_to_collection_event(collection_to_entity_id, &self.0)
            .await
    }
}
