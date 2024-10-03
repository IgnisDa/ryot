use sea_orm::DatabaseConnection;

pub struct CacheService {
    db: DatabaseConnection,
}

impl CacheService {
    pub fn new(db: &DatabaseConnection) -> Self {
        Self { db: db.clone() }
    }
}

impl CacheService {}
