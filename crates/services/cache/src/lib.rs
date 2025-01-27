use std::{collections::HashMap, sync::Arc};

use async_graphql::Result;
use chrono::{Duration, Utc};
use common_utils::ryot_log;
use database_models::{application_cache, prelude::ApplicationCache};
use dependent_models::{ApplicationCacheValue, GetCacheKeyResponse};
use either::Either;
use media_models::ApplicationCacheKey;
use sea_orm::{ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use sea_query::OnConflict;
use serde::de::DeserializeOwned;
use uuid::Uuid;

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
            | ApplicationCacheKey::UserAnalytics { .. }
            | ApplicationCacheKey::MetadataSearch { .. }
            | ApplicationCacheKey::UserMetadataList { .. }
            | ApplicationCacheKey::MetadataGroupSearch { .. }
            | ApplicationCacheKey::UserCollectionContents { .. }
            | ApplicationCacheKey::MetadataRecentlyConsumed { .. }
            | ApplicationCacheKey::UserMetadataRecommendations { .. } => 1,

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
    ) -> Result<HashMap<ApplicationCacheKey, Uuid>> {
        let now = Utc::now();
        let mut response = HashMap::new();
        for (key, value) in items {
            let version = self
                .should_respect_version(&key)
                .then(|| self.version.to_owned());
            let to_insert = application_cache::ActiveModel {
                created_at: ActiveValue::Set(now),
                key: ActiveValue::Set(key.clone()),
                version: ActiveValue::Set(version),
                value: ActiveValue::Set(serde_json::to_value(value).unwrap()),
                expires_at: ActiveValue::Set(now + Duration::hours(self.get_expiry_for_key(&key))),
                ..Default::default()
            };
            let inserted = ApplicationCache::insert(to_insert)
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
            response.insert(key, insert_id);
        }
        ryot_log!(debug, "Inserted application caches: {response:?}");
        Ok(response)
    }

    pub async fn set_key(
        &self,
        key: ApplicationCacheKey,
        value: ApplicationCacheValue,
    ) -> Result<Uuid> {
        let response = self.set_keys(vec![(key.clone(), value)]).await?;
        let uuid = response.get(&key).unwrap().to_owned();
        Ok(uuid)
    }

    pub async fn get_values(
        &self,
        keys: Vec<ApplicationCacheKey>,
    ) -> Result<HashMap<ApplicationCacheKey, GetCacheKeyResponse>> {
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
            values.insert(
                cache.key,
                GetCacheKeyResponse {
                    id: cache.id,
                    value: serde_json::from_value(cache.value)?,
                },
            );
        }
        Ok(values)
    }

    pub async fn get_value<T: DeserializeOwned>(
        &self,
        key: ApplicationCacheKey,
    ) -> Option<(Uuid, T)> {
        let caches = self.get_values(vec![key.clone()]).await.ok()?;
        let value = caches.get(&key)?;
        let db_value = serde_json::to_value(&value.value).ok()?;
        let db_value = db_value
            .get(key.to_string())
            .and_then(|v| serde_json::from_value::<T>(v.to_owned()).ok())?;
        Some((value.id, db_value))
    }

    pub async fn expire_key(&self, by: Either<ApplicationCacheKey, Uuid>) -> Result<bool> {
        let deleted = ApplicationCache::update_many()
            .filter(match by {
                Either::Right(id) => application_cache::Column::Id.eq(id),
                Either::Left(key) => application_cache::Column::Key.eq(key),
            })
            .set(application_cache::ActiveModel {
                expires_at: ActiveValue::Set(Utc::now()),
                ..Default::default()
            })
            .exec(&self.db)
            .await?;
        Ok(deleted.rows_affected > 0)
    }
}
