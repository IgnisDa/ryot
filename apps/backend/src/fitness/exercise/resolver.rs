use std::sync::Arc;

use sea_orm::DatabaseConnection;

use crate::file_storage::FileStorageService;

#[derive(Debug)]
pub struct ExerciseService {
    db: DatabaseConnection,
    file_storage: Arc<FileStorageService>,
}

impl ExerciseService {
    #[allow(clippy::too_many_arguments)]
    pub fn new(db: &DatabaseConnection, file_storage: Arc<FileStorageService>) -> Self {
        Self {
            db: db.clone(),
            file_storage,
        }
    }
}
