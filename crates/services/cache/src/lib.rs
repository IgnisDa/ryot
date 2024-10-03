use sea_orm::DatabaseConnection;

pub struct CollectionService {
    db: DatabaseConnection,
}

impl CollectionService {
    pub fn new(db: &DatabaseConnection) -> Self {
        Self { db: db.clone() }
    }
}

impl CollectionService {}
