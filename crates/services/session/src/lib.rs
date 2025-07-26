use std::sync::Arc;

use anyhow::Result;
use dependent_models::{ApplicationCacheKey, ApplicationCacheValue, ExpireCacheKeyInput};
use supporting_service::SupportingService;
use uuid::Uuid;

pub struct SessionService(pub Arc<SupportingService>);

impl SessionService {
    pub async fn create_session(&self, user_id: String) -> Result<String> {
        let session_id = Uuid::new_v4().to_string();

        let cache_key = ApplicationCacheKey::UserSession {
            session_id: session_id.clone(),
        };
        let cache_value = ApplicationCacheValue::UserSession(user_id);

        cache_service::set_key(&self.0, cache_key, cache_value).await?;

        Ok(session_id)
    }

    pub async fn validate_session(&self, session_id: &str) -> Result<Option<String>> {
        let cache_key = ApplicationCacheKey::UserSession {
            session_id: session_id.to_string(),
        };

        match cache_service::get_value::<String>(&self.0, cache_key).await {
            Some((_, user_id)) => Ok(Some(user_id)),
            None => Ok(None),
        }
    }

    pub async fn invalidate_session(&self, session_id: &str) -> Result<()> {
        let cache_key = ApplicationCacheKey::UserSession {
            session_id: session_id.to_string(),
        };

        cache_service::expire_key(&self.0, ExpireCacheKeyInput::ByKey(cache_key)).await?;

        Ok(())
    }
}
