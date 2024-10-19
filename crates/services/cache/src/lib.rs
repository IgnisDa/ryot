use async_graphql::Result;
use chrono::{Duration, Utc};
use common_models::ApplicationCacheKey;
use common_utils::ryot_log;
use database_models::{application_cache, prelude::ApplicationCache};
use sea_orm::{ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use sea_query::OnConflict;
use uuid::Uuid;

pub struct CacheService {
    db: DatabaseConnection,
}

impl CacheService {
    pub fn new(db: &DatabaseConnection) -> Self {
        Self { db: db.clone() }
    }
}

impl CacheService {
    pub async fn set_with_expiry(
        &self,
        key: ApplicationCacheKey,
        expiry_hours: i64,
    ) -> Result<Uuid> {
        let now = Utc::now();
        let to_insert = application_cache::ActiveModel {
            key: ActiveValue::Set(key),
            expires_at: ActiveValue::Set(Some(now + Duration::hours(expiry_hours))),
            created_at: ActiveValue::Set(now),
            ..Default::default()
        };
        let inserted = ApplicationCache::insert(to_insert)
            .on_conflict(
                OnConflict::column(application_cache::Column::Key)
                    .update_columns([
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

    pub async fn get(&self, key: ApplicationCacheKey) -> Result<Option<()>> {
        let cache = ApplicationCache::find()
            .filter(application_cache::Column::Key.eq(key))
            .one(&self.db)
            .await?;
        Ok(cache
            .filter(|cache| {
                cache
                    .expires_at
                    .map_or(false, |expires_at| expires_at > Utc::now())
            })
            .map(|_| ()))
    }

    pub async fn delete(&self, key: ApplicationCacheKey) -> Result<bool> {
        let deleted = ApplicationCache::delete_many()
            .filter(application_cache::Column::Key.eq(key))
            .exec(&self.db)
            .await?;
        Ok(deleted.rows_affected > 0)
    }
}
