use std::sync::Arc;

use apalis::{prelude::Storage, sqlite::SqliteStorage};
use async_graphql::{Context, Object, Result};
use sea_orm::DatabaseConnection;

use crate::{
    background::UpdateExerciseJob,
    file_storage::FileStorageService,
    models::fitness::{Exercise, ExerciseAttributes},
};

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
    json_url: String,
    image_prefix_url: String,
    update_exercise: SqliteStorage<UpdateExerciseJob>,
}

impl ExerciseService {
    pub fn new(
        db: &DatabaseConnection,
        file_storage: Arc<FileStorageService>,
        json_url: String,
        image_prefix_url: String,
        update_exercise: &SqliteStorage<UpdateExerciseJob>,
    ) -> Self {
        Self {
            db: db.clone(),
            file_storage,
            json_url,
            image_prefix_url,
            update_exercise: update_exercise.clone(),
        }
    }
}

impl ExerciseService {
    async fn get_all_exercises(&self) -> Result<Vec<Exercise>> {
        let data: Vec<Exercise> = surf::get(&self.json_url)
            .send()
            .await
            .unwrap()
            .body_json()
            .await
            .unwrap();
        Ok(data
            .into_iter()
            .map(|e| Exercise {
                attributes: ExerciseAttributes {
                    images: e
                        .attributes
                        .images
                        .into_iter()
                        .map(|i| format!("{}/{}", self.image_prefix_url, i))
                        .collect(),
                    ..e.attributes
                },
                ..e
            })
            .collect())
    }

    async fn deploy_update_exercise_library_job(&self) -> Result<Vec<String>> {
        let mut storage = self.update_exercise.clone();
        let exercises = self.get_all_exercises().await?;
        let mut job_ids = vec![];
        for exercise in exercises {
            let job = storage.push(UpdateExerciseJob { exercise }).await?;
            job_ids.push(job.to_string());
        }
        Ok(job_ids)
    }

    pub async fn update_exercise(&self, exercise: Exercise) -> Result<()> {
        dbg!(exercise);
        todo!()
    }
}
