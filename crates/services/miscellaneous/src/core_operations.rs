use async_graphql::Result;
use dependent_models::ExpireCacheKeyInput;
use supporting_service::SupportingService;
use uuid::Uuid;

pub async fn expire_cache_key(
    supporting_service: &SupportingService,
    cache_id: Uuid,
) -> Result<bool> {
    supporting_service
        .cache_service
        .expire_key(ExpireCacheKeyInput::ById(cache_id))
        .await?;
    Ok(true)
}
