use std::{collections::HashMap, future::Future, sync::Arc};

use anyhow::Result;
use async_graphql::OutputType;
use chrono::{Duration, Utc};
use common_utils::ryot_log;
use database_models::{application_cache, prelude::ApplicationCache};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CachedResponse, ExpireCacheKeyInput,
    GetCacheKeyResponse,
};
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
    fn get_expiry_for_key(&self, key: &ApplicationCacheKey) -> Duration {
        match key {
            ApplicationCacheKey::UserTwoFactorRateLimit { .. } => Duration::seconds(5),

            ApplicationCacheKey::SpotifyAccessToken => Duration::minutes(50),

            ApplicationCacheKey::CoreDetails
            | ApplicationCacheKey::PeopleSearch { .. }
            | ApplicationCacheKey::UserAnalytics { .. }
            | ApplicationCacheKey::UserPeopleList { .. }
            | ApplicationCacheKey::MetadataSearch { .. }
            | ApplicationCacheKey::UserMetadataList { .. }
            | ApplicationCacheKey::UserWorkoutsList { .. }
            | ApplicationCacheKey::UserExercisesList { .. }
            | ApplicationCacheKey::UserTwoFactorSetup { .. }
            | ApplicationCacheKey::MetadataGroupSearch { .. }
            | ApplicationCacheKey::UserMeasurementsList { .. }
            | ApplicationCacheKey::UserMetadataGroupsList { .. }
            | ApplicationCacheKey::UserCollectionContents { .. }
            | ApplicationCacheKey::UserWorkoutTemplatesList { .. }
            | ApplicationCacheKey::MetadataRecentlyConsumed { .. }
            | ApplicationCacheKey::UserMetadataRecommendations { .. } => Duration::hours(1),

            ApplicationCacheKey::MetadataProgressUpdateCompletedCache { .. } => {
                Duration::hours(self.config.server.progress_update_threshold)
            }

            ApplicationCacheKey::UserCollectionsList { .. }
            | ApplicationCacheKey::UserAnalyticsParameters { .. } => Duration::hours(8),

            ApplicationCacheKey::TrendingMetadataIds
            | ApplicationCacheKey::MetadataLookup { .. }
            | ApplicationCacheKey::YoutubeMusicSongListened { .. }
            | ApplicationCacheKey::CollectionRecommendations { .. }
            | ApplicationCacheKey::UserMetadataRecommendationsSet { .. } => Duration::days(1),

            ApplicationCacheKey::IgdbSettings
            | ApplicationCacheKey::TmdbSettings
            | ApplicationCacheKey::ListennotesSettings => Duration::days(5),

            ApplicationCacheKey::MetadataProgressUpdateInProgressCache { .. } => Duration::days(60),
        }
    }

    fn should_respect_version(&self, key: &ApplicationCacheKey) -> bool {
        matches!(key, ApplicationCacheKey::CoreDetails)
    }

    pub async fn set_keys(
        &self,
        items: Vec<(ApplicationCacheKey, ApplicationCacheValue)>,
    ) -> Result<HashMap<ApplicationCacheKey, Uuid>> {
        if items.is_empty() {
            return Ok(HashMap::new());
        }
        let now = Utc::now();
        let mut response = HashMap::new();
        for (key, value) in items {
            let version = self
                .should_respect_version(&key)
                .then(|| self.version.to_owned());
            let key_value = serde_json::to_value(&key).unwrap();

            let user_id = key_value
                .as_object()
                .and_then(|obj| obj.values().next())
                .and_then(|variant_obj| variant_obj.get("user_id"))
                .and_then(|id| id.as_str())
                .map(|s| format!("-{}", s))
                .unwrap_or_default();

            let sanitized_key = format!("{}{}", key, user_id);

            let to_insert = application_cache::ActiveModel {
                key: ActiveValue::Set(key_value),
                created_at: ActiveValue::Set(now),
                version: ActiveValue::Set(version),
                sanitized_key: ActiveValue::Set(sanitized_key),
                value: ActiveValue::Set(serde_json::to_value(&value).unwrap()),
                expires_at: ActiveValue::Set(now + self.get_expiry_for_key(&key)),
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
                            application_cache::Column::SanitizedKey,
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
            .filter(application_cache::Column::ExpiresAt.gt(Utc::now()))
            .all(&self.db)
            .await?;

        let mut values = HashMap::new();
        for cache in caches {
            if let Some(version) = cache.version {
                if version != self.version {
                    continue;
                }
            }
            values.insert(
                serde_json::from_value(cache.key).unwrap(),
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

    pub async fn get_or_set_with_callback<T, F, Fut>(
        &self,
        key: ApplicationCacheKey,
        cache_value_constructor: impl FnOnce(T) -> ApplicationCacheValue,
        generator: F,
    ) -> Result<CachedResponse<T>>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T>>,
        T: DeserializeOwned + Clone + OutputType,
    {
        if let Some((cache_id, response)) = self.get_value::<T>(key.clone()).await {
            return Ok(CachedResponse { cache_id, response });
        }

        let response = generator().await?;
        let cache_id = self
            .set_key(key, cache_value_constructor(response.clone()))
            .await?;
        Ok(CachedResponse { cache_id, response })
    }

    pub async fn expire_key(&self, by: ExpireCacheKeyInput) -> Result<()> {
        let expired = ApplicationCache::update_many()
            .filter(application_cache::Column::ExpiresAt.gt(Utc::now()))
            .filter(match by.clone() {
                ExpireCacheKeyInput::ById(id) => application_cache::Column::Id.eq(id),
                ExpireCacheKeyInput::ByKey(key) => application_cache::Column::Key.eq(key),
                ExpireCacheKeyInput::ByUser(user_id) => {
                    application_cache::Column::SanitizedKey.like(format!("%-{}", user_id))
                }
                ExpireCacheKeyInput::BySanitizedKey { key, user_id } => {
                    let sanitized_key = match (key, user_id) {
                        (key, None) => key.to_string(),
                        (key, Some(user_id)) => format!("{}-{}", key, user_id),
                    };
                    application_cache::Column::SanitizedKey.eq(sanitized_key)
                }
            })
            .set(application_cache::ActiveModel {
                expires_at: ActiveValue::Set(Utc::now()),
                ..Default::default()
            })
            .exec(&self.db)
            .await?;
        ryot_log!(debug, "Expired cache: {by:?}, response: {expired:?}");
        Ok(())
    }
}
