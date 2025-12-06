use std::sync::Arc;

use anyhow::Result;
use background_models::{ApplicationJob, HpApplicationJob};
use common_models::ChangeCollectionToEntitiesInput;
use supporting_service::SupportingService;

pub mod content_operations;
pub mod event_operations;
pub mod management_operations;
pub mod recommendation_operations;

pub async fn deploy_add_entities_to_collection_job(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: ChangeCollectionToEntitiesInput,
) -> Result<bool> {
    ss.perform_application_job(ApplicationJob::Hp(
        HpApplicationJob::AddEntitiesToCollection(user_id, input),
    ))
    .await?;
    Ok(true)
}

pub async fn deploy_remove_entities_from_collection_job(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: ChangeCollectionToEntitiesInput,
) -> Result<bool> {
    ss.perform_application_job(ApplicationJob::Hp(
        HpApplicationJob::RemoveEntitiesFromCollection(user_id, input),
    ))
    .await?;
    Ok(true)
}
