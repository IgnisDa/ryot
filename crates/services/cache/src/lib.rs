use async_graphql::Result;
use chrono::{Duration, Utc};
use common_models::ApplicationCacheKey;
use database_models::{application_cache, prelude::ApplicationCache};
use sea_orm::{ActiveValue, DatabaseConnection, EntityTrait};
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
        expiry_seconds: i64,
    ) -> Result<Uuid> {
        let to_insert = application_cache::ActiveModel {
            key: ActiveValue::Set(key),
            expires_at: ActiveValue::Set(Some(Utc::now() + Duration::seconds(expiry_seconds))),
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
        Ok(inserted.last_insert_id)
    }
}
