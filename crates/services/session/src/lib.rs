use anyhow::Result;
use cache_service::CacheService;
use dependent_models::{ApplicationCacheKey, ApplicationCacheValue, ExpireCacheKeyInput};
use uuid::Uuid;

pub struct SessionService {
    cache: CacheService,
}

impl SessionService {
    pub fn new(cache: CacheService) -> Self {
        Self { cache }
    }

    pub async fn create_session(&self, user_id: String) -> Result<String> {
        let session_id = Uuid::new_v4().to_string();

        let cache_key = ApplicationCacheKey::UserSession {
            session_id: session_id.clone(),
        };
        let cache_value = ApplicationCacheValue::UserSession(user_id);

        self.cache.set_key(cache_key, cache_value).await?;

        Ok(session_id)
    }

    pub async fn validate_session(&self, session_id: &str) -> Result<Option<String>> {
        let cache_key = ApplicationCacheKey::UserSession {
            session_id: session_id.to_string(),
        };

        match self.cache.get_value::<String>(cache_key).await {
            Some((_, user_id)) => Ok(Some(user_id)),
            None => Ok(None),
        }
    }

    pub async fn invalidate_session(&self, session_id: &str) -> Result<()> {
        let cache_key = ApplicationCacheKey::UserSession {
            session_id: session_id.to_string(),
        };

        self.cache
            .expire_key(ExpireCacheKeyInput::ByKey(cache_key))
            .await?;

        Ok(())
    }
}
