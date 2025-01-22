use std::{collections::HashMap, sync::Arc};

use async_graphql::Result;
use chrono::{Duration, Utc};
use common_models::ApplicationCacheKey;
use common_utils::ryot_log;
use database_models::{application_cache, prelude::ApplicationCache};
use dependent_models::ApplicationCacheValue;
use itertools::Itertools;
use sea_orm::{ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use sea_query::OnConflict;
use serde::de::DeserializeOwned;

pub struct CacheService {
    version: String,
    db: DatabaseConnection,
    config: Arc<config::AppConfig>,
}

impl CacheService {
    pub fn new(db: &DatabaseConnection, config: Arc<config::AppConfig>) -> Self {
        Self {
            config,
            db: db.clone(),
            version: Utc::now().to_rfc2822(),
        }
    }
}

impl CacheService {
    fn get_expiry_for_key(&self, key: &ApplicationCacheKey) -> i64 {
        match key {
            ApplicationCacheKey::CoreDetails
            | ApplicationCacheKey::PeopleSearch { .. }
            | ApplicationCacheKey::MetadataSearch { .. }
            | ApplicationCacheKey::MetadataGroupSearch { .. }
            | ApplicationCacheKey::MetadataRecentlyConsumed { .. }
            | ApplicationCacheKey::UserMetadataRecommendations { .. } => 1,

            ApplicationCacheKey::UserAnalytics { .. } => 2,

            ApplicationCacheKey::UserCollectionsList { .. }
            | ApplicationCacheKey::UserAnalyticsParameters { .. } => 8,

            ApplicationCacheKey::ProgressUpdateCache { .. } => {
                self.config.server.progress_update_threshold
            }

            ApplicationCacheKey::YoutubeMusicSongListened { .. } => 24,

            ApplicationCacheKey::IgdbSettings
            | ApplicationCacheKey::TmdbSettings
            | ApplicationCacheKey::ListennotesSettings => 120,
        }
    }

    fn should_respect_version(&self, key: &ApplicationCacheKey) -> bool {
        matches!(key, ApplicationCacheKey::CoreDetails)
    }

    pub async fn set_keys(
        &self,
        items: Vec<(ApplicationCacheKey, ApplicationCacheValue)>,
    ) -> Result<()> {
        let now = Utc::now();
        let to_insert = items
            .into_iter()
            .map(|(key, value)| {
                let version = self
                    .should_respect_version(&key)
                    .then(|| self.version.to_owned());
                application_cache::ActiveModel {
                    created_at: ActiveValue::Set(now),
                    key: ActiveValue::Set(key.clone()),
                    version: ActiveValue::Set(version),
                    value: ActiveValue::Set(serde_json::to_value(value).unwrap()),
                    expires_at: ActiveValue::Set(
                        now + Duration::hours(self.get_expiry_for_key(&key)),
                    ),
                    ..Default::default()
                }
            })
            .collect_vec();
        let inserted = ApplicationCache::insert_many(to_insert)
            .on_conflict(
                OnConflict::column(application_cache::Column::Key)
                    .update_columns([
                        application_cache::Column::Value,
                        application_cache::Column::Version,
                        application_cache::Column::ExpiresAt,
                        application_cache::Column::CreatedAt,
                    ])
                    .to_owned(),
            )
            .exec(&self.db)
            .await?;
        let insert_id = inserted.last_insert_id;
        ryot_log!(debug, "Inserted application cache with id = {insert_id:?}");
        Ok(())
    }

    pub async fn set_key(
        &self,
        key: ApplicationCacheKey,
        value: ApplicationCacheValue,
    ) -> Result<()> {
        self.set_keys(vec![(key, value)]).await
    }

    pub async fn get_values(
        &self,
        keys: Vec<ApplicationCacheKey>,
    ) -> Result<HashMap<ApplicationCacheKey, ApplicationCacheValue>> {
        let caches = ApplicationCache::find()
            .filter(application_cache::Column::Key.is_in(keys))
            .all(&self.db)
            .await?;
        let mut values = HashMap::new();
        for cache in caches {
            let valid_by_expiry = cache.expires_at > Utc::now();
            if !valid_by_expiry {
                continue;
            }
            if let Some(version) = cache.version {
                if version != self.version {
                    continue;
                }
            }
            values.insert(cache.key, serde_json::from_value(cache.value)?);
        }
        Ok(values)
    }

    pub async fn get_value<T: DeserializeOwned>(&self, key: ApplicationCacheKey) -> Option<T> {
        let caches = self.get_values(vec![key.clone()]).await.ok()?;
        let db_value = serde_json::to_value(caches.get(&key)?).ok()?;
        db_value
            .get(key.to_string())
            .and_then(|v| serde_json::from_value::<T>(v.to_owned()).ok())
    }

    pub async fn expire_key(&self, key: ApplicationCacheKey) -> Result<bool> {
        let deleted = ApplicationCache::update_many()
            .filter(application_cache::Column::Key.eq(key))
            .set(application_cache::ActiveModel {
                expires_at: ActiveValue::Set(Utc::now()),
                ..Default::default()
            })
            .exec(&self.db)
            .await?;
        Ok(deleted.rows_affected > 0)
    }
}
