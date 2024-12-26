use async_graphql::Result;
use common_models::ApplicationCacheKey;
use sea_orm::DatabaseConnection;

pub struct LockService {
    db: DatabaseConnection,
}

impl LockService {
    pub fn new(db: &DatabaseConnection) -> Self {
        Self { db: db.clone() }
    }
}

impl LockService {
    pub async fn acquire_lock(&self, key: ApplicationCacheKey) -> Result<bool> {
        todo!()
    }
}
