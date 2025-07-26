use std::sync::Arc;

use anyhow::Result;
use dependent_models::{ApplicationCacheKey, ApplicationCacheValue, ExpireCacheKeyInput};
use supporting_service::SupportingService;
use uuid::Uuid;

pub async fn create_session(ss: &Arc<SupportingService>, user_id: String) -> Result<String> {
    let session_id = Uuid::new_v4().to_string();
    let cache_key = ApplicationCacheKey::UserSession {
        session_id: session_id.clone(),
    };
    let cache_value = ApplicationCacheValue::UserSession(user_id);
    cache_service::set_key(ss, cache_key, cache_value).await?;
    Ok(session_id)
}

pub async fn validate_session(
    ss: &Arc<SupportingService>,
    session_id: &str,
) -> Result<Option<String>> {
    let cache_key = ApplicationCacheKey::UserSession {
        session_id: session_id.to_string(),
    };
    match cache_service::get_value::<String>(ss, cache_key).await {
        None => Ok(None),
        Some((_, user_id)) => Ok(Some(user_id)),
    }
}

pub async fn invalidate_session(ss: &Arc<SupportingService>, session_id: &str) -> Result<()> {
    let cache_key = ApplicationCacheKey::UserSession {
        session_id: session_id.to_string(),
    };
    cache_service::expire_key(ss, ExpireCacheKeyInput::ByKey(cache_key)).await?;
    Ok(())
}
