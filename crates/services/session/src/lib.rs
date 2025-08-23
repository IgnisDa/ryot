use std::sync::Arc;

use anyhow::Result;
use chrono::Duration;
use common_utils::generate_session_id;
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, ExpireCacheKeyInput, UserSessionInput,
    UserSessionValue,
};
use supporting_service::SupportingService;

pub async fn create_session(
    ss: &Arc<SupportingService>,
    user_id: String,
    access_link_id: Option<String>,
    expiry_duration: Option<Duration>,
) -> Result<String> {
    let session_id = generate_session_id(None);
    let cache_key = ApplicationCacheKey::UserSession(UserSessionInput {
        session_id: session_id.clone(),
    });
    let cache_value = ApplicationCacheValue::UserSession(UserSessionValue {
        user_id,
        access_link_id,
    });
    match expiry_duration {
        Some(duration) => {
            cache_service::set_key_with_expiry(ss, cache_key, cache_value, duration).await?;
        }
        None => {
            cache_service::set_key(ss, cache_key, cache_value).await?;
        }
    }
    Ok(session_id)
}

pub async fn validate_session(
    ss: &Arc<SupportingService>,
    session_id: &str,
) -> Result<Option<UserSessionValue>> {
    let cache_key = ApplicationCacheKey::UserSession(UserSessionInput {
        session_id: session_id.to_owned(),
    });
    let value = cache_service::get_value::<UserSessionValue>(ss, cache_key)
        .await
        .map(|(_key, value)| value);
    Ok(value)
}

pub async fn invalidate_session(ss: &Arc<SupportingService>, session_id: &str) -> Result<()> {
    let cache_key = ApplicationCacheKey::UserSession(UserSessionInput {
        session_id: session_id.to_owned(),
    });
    cache_service::expire_key(ss, ExpireCacheKeyInput::ByKey(Box::new(cache_key))).await?;
    Ok(())
}
