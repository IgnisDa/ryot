use async_graphql::Result;
use common_models::ApplicationCacheKey;
use common_utils::ryot_log;
use sea_orm::DatabaseConnection;
use sqlx::postgres::PgAdvisoryLock;

pub struct LockService {
    db: DatabaseConnection,
}

impl LockService {
    pub fn new(db: &DatabaseConnection) -> Self {
        Self { db: db.clone() }
    }
}

impl LockService {
    pub async fn acquire_lock(&self, key: &ApplicationCacheKey) -> Result<()> {
        let key_string = serde_json::to_string(key)?;
        let lock = PgAdvisoryLock::new(key_string);
        ryot_log!(debug, "Acquiring lock for key: {:?}", key);
        let conn = self.db.get_postgres_connection_pool().acquire().await?;
        lock.acquire(conn).await?;
        Ok(())
    }
}
