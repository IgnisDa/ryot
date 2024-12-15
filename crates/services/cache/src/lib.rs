use std::sync::Arc;

use async_graphql::Result;
use chrono::{Duration, Utc};
use common_models::ApplicationCacheKey;
use common_utils::ryot_log;
use database_models::{application_cache, prelude::ApplicationCache};
use dependent_models::ApplicationCacheValue;
use sea_orm::{ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use sea_query::OnConflict;
use uuid::Uuid;

pub struct CacheService {
    db: DatabaseConnection,
    config: Arc<config::AppConfig>,
}

impl CacheService {
    pub fn new(db: &DatabaseConnection, config: Arc<config::AppConfig>) -> Self {
        Self {
            config,
            db: db.clone(),
        }
    }
}

impl CacheService {
    fn get_expiry_for_key(&self, key: &ApplicationCacheKey) -> Option<i64> {
        match key {
            ApplicationCacheKey::UserAnalyticsParameters { .. } => Some(8),
            ApplicationCacheKey::UserAnalytics { .. } => Some(2),
            ApplicationCacheKey::IgdbSettings
            | ApplicationCacheKey::ListennotesSettings
            | ApplicationCacheKey::ServerKeyValidated
            | ApplicationCacheKey::TmdbSettings => None,
            ApplicationCacheKey::MetadataRecentlyConsumed { .. } => Some(1),
            ApplicationCacheKey::ProgressUpdateCache { .. } => {
                Some(self.config.server.progress_update_threshold)
            }
        }
    }

    pub async fn set_with_expiry(
        &self,
        key: ApplicationCacheKey,
        value: ApplicationCacheValue,
    ) -> Result<Uuid> {
        let now = Utc::now();
        let expiry_hours = self.get_expiry_for_key(&key);
        let to_insert = application_cache::ActiveModel {
            key: ActiveValue::Set(key),
            value: ActiveValue::Set(serde_json::to_value(value)?),
            created_at: ActiveValue::Set(now),
            expires_at: ActiveValue::Set(expiry_hours.map(|hours| now + Duration::hours(hours))),
            ..Default::default()
        };
        let inserted = ApplicationCache::insert(to_insert)
            .on_conflict(
                OnConflict::column(application_cache::Column::Key)
                    .update_columns([
                        application_cache::Column::Value,
                        application_cache::Column::ExpiresAt,
                        application_cache::Column::CreatedAt,
                    ])
                    .to_owned(),
            )
            .exec(&self.db)
            .await?;
        let insert_id = inserted.last_insert_id;
        ryot_log!(debug, "Inserted application cache with id = {insert_id:?}");
        Ok(insert_id)
    }

    pub async fn get_key(&self, key: ApplicationCacheKey) -> Result<Option<ApplicationCacheValue>> {
        let cache = ApplicationCache::find()
            .filter(application_cache::Column::Key.eq(key.clone()))
            .one(&self.db)
            .await?;
        let Some(db_value) = cache
            .filter(|cache| {
                cache
                    .expires_at
                    .map_or(true, |expires_at| expires_at > Utc::now())
            })
            .map(|m| m.value)
        else {
            return Ok(None);
        };
        let parsed = serde_json::from_value(db_value);
        match key {
            ApplicationCacheKey::UserAnalytics { .. } => {
                if let Ok(Some(ApplicationCacheValue::UserAnalytics(value))) = parsed {
                    return Ok(Some(ApplicationCacheValue::UserAnalytics(value)));
                }
            }
            ApplicationCacheKey::UserAnalyticsParameters { .. } => {
                if let Ok(Some(ApplicationCacheValue::UserAnalyticsParameters(value))) = parsed {
                    return Ok(Some(ApplicationCacheValue::UserAnalyticsParameters(value)));
                }
            }
            ApplicationCacheKey::IgdbSettings => {
                if let Ok(Some(ApplicationCacheValue::IgdbSettings { access_token })) = parsed {
                    return Ok(Some(ApplicationCacheValue::IgdbSettings { access_token }));
                }
            }
            ApplicationCacheKey::TmdbSettings => {
                if let Ok(Some(ApplicationCacheValue::TmdbSettings(value))) = parsed {
                    return Ok(Some(ApplicationCacheValue::TmdbSettings(value)));
                }
            }
            ApplicationCacheKey::ListennotesSettings => {
                if let Ok(Some(ApplicationCacheValue::ListennotesSettings { genres })) = parsed {
                    return Ok(Some(ApplicationCacheValue::ListennotesSettings { genres }));
                }
            }
            ApplicationCacheKey::MetadataRecentlyConsumed { .. }
            | ApplicationCacheKey::ProgressUpdateCache { .. }
            | ApplicationCacheKey::ServerKeyValidated => {
                if let Ok(Some(ApplicationCacheValue::Empty)) = parsed {
                    return Ok(Some(ApplicationCacheValue::Empty));
                }
            }
        };
        return Ok(None);
    }

    pub async fn expire_key(&self, key: ApplicationCacheKey) -> Result<bool> {
        let deleted = ApplicationCache::update_many()
            .filter(application_cache::Column::Key.eq(key))
            .set(application_cache::ActiveModel {
                expires_at: ActiveValue::Set(Some(Utc::now())),
                ..Default::default()
            })
            .exec(&self.db)
            .await?;
        Ok(deleted.rows_affected > 0)
    }
}
