use std::{ffi::OsStr, path::Path, sync::Arc};

use apalis::{prelude::Storage, sqlite::SqliteStorage};
use async_graphql::{Context, Object, Result};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};
use slug::slugify;

use crate::{
    background::UpdateExerciseJob,
    entities::{exercise, prelude::Exercise},
    file_storage::FileStorageService,
    models::fitness::{Exercise as GithubExercise, ExerciseAttributes},
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
    async fn get_all_exercises(&self) -> Result<Vec<GithubExercise>> {
        let data: Vec<GithubExercise> = surf::get(&self.json_url)
            .send()
            .await
            .unwrap()
            .body_json()
            .await
            .unwrap();
        Ok(data
            .into_iter()
            .map(|e| GithubExercise {
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

    pub async fn update_exercise(&self, ex: GithubExercise) -> Result<()> {
        if Exercise::find()
            .filter(exercise::Column::Identifier.eq(&ex.identifier))
            .one(&self.db)
            .await?
            .is_none()
        {
            let mut images = vec![];
            let mut attributes = ex.attributes.clone();
            for (idx, image) in ex.attributes.images.into_iter().enumerate() {
                let ext = Path::new(&image)
                    .extension()
                    .and_then(OsStr::to_str)
                    .unwrap_or("png");
                let key = format!(
                    "fitness/exercises/{iden}/{idx}.{ext}",
                    iden = slugify(&ex.identifier)
                );
                let image_data = surf::get(image)
                    .send()
                    .await
                    .unwrap()
                    .body_bytes()
                    .await
                    .unwrap();
                images.push(key.clone());
                self.file_storage
                    .upload_file(&key, image_data.into())
                    .await?;
            }
            attributes.images = images;
            let db_exercise = exercise::ActiveModel {
                name: ActiveValue::Set(ex.name),
                identifier: ActiveValue::Set(ex.identifier),
                attributes: ActiveValue::Set(attributes),
                ..Default::default()
            };
            db_exercise.insert(&self.db).await?;
        }
        Ok(())
    }
}
