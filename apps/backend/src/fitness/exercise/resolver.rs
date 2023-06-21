use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use sea_orm::DatabaseConnection;

use crate::file_storage::FileStorageService;

#[derive(Default)]
pub struct ExerciseMutation;

#[Object]
impl ExerciseMutation {
    /// Deploy a job to download update the exercise library
    async fn deploy_update_exercise_library_job(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<Vec<String>> {
        gql_ctx
            .data_unchecked::<Arc<ExerciseService>>()
            .deploy_update_exercise_library_job()
            .await
    }
}

#[derive(Debug)]
pub struct ExerciseService {
    db: DatabaseConnection,
    file_storage: Arc<FileStorageService>,
}

impl ExerciseService {
    pub fn new(db: &DatabaseConnection, file_storage: Arc<FileStorageService>) -> Self {
        Self {
            db: db.clone(),
            file_storage,
        }
    }
}

impl ExerciseService {
    async fn deploy_update_exercise_library_job(&self) -> Result<Vec<String>> {
        todo!()
    }
}
