use std::sync::Arc;

use apalis::sqlite::SqliteStorage;
use async_graphql::{Context, Object, Result};
use sea_orm::DatabaseConnection;

use crate::{background::UpdateExerciseJob, file_storage::FileStorageService};

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
    async fn get_all_exercises(&self) -> Result<Vec<models::Exercise>> {
        let data: Vec<models::Exercise> = surf::get(&self.json_url)
            .send()
            .await
            .unwrap()
            .body_json()
            .await
            .unwrap();
        Ok(data
            .into_iter()
            .map(|e| models::Exercise {
                images: e
                    .images
                    .into_iter()
                    .map(|i| format!("{}/{}", self.image_prefix_url, i))
                    .collect(),
                ..e
            })
            .collect())
    }

    async fn deploy_update_exercise_library_job(&self) -> Result<Vec<String>> {
        let data = self.get_all_exercises().await?;
        todo!()
    }

    pub async fn update_exercise(&self, exercise: models::Exercise) -> Result<()> {
        dbg!(exercise);
        todo!()
    }
}

pub mod models {
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "snake_case")]
    pub enum ExerciseForce {
        Static,
        Pull,
        Push,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "snake_case")]
    pub enum ExerciseLevel {
        Beginner,
        Intermediate,
        Expert,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "snake_case")]
    pub enum ExerciseMechanic {
        Isolation,
        Compound,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "snake_case")]
    pub enum ExerciseEquipment {
        #[serde(rename = "medicine ball")]
        MedicineBall,
        Dumbbell,
        #[serde(rename = "body only")]
        BodyOnly,
        Bands,
        Kettlebells,
        #[serde(rename = "foam roll")]
        FoamRoll,
        Cable,
        Machine,
        Barbell,
        #[serde(rename = "exercise ball")]
        ExerciseBall,
        #[serde(rename = "e-z curl bar")]
        EZCurlBar,
        Other,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "snake_case")]
    pub enum ExerciseMuscle {
        Abdominals,
        Abductors,
        Adductors,
        Biceps,
        Calves,
        Chest,
        Forearms,
        Glutes,
        Hamstrings,
        Lats,
        #[serde(rename = "lower back")]
        LowerBack,
        #[serde(rename = "middle back")]
        MiddleBack,
        Neck,
        Quadriceps,
        Shoulders,
        Traps,
        Triceps,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "snake_case")]
    pub enum ExerciseCategory {
        Powerlifting,
        Strength,
        Stretching,
        Cardio,
        #[serde(rename = "olympic weightlifting")]
        OlympicWeightlifting,
        Strongman,
        Plyometrics,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Exercise {
        #[serde(rename = "id")]
        pub identifier: String,
        pub name: String,
        pub force: Option<ExerciseForce>,
        pub level: ExerciseLevel,
        pub mechanic: Option<ExerciseMechanic>,
        pub equipment: Option<ExerciseEquipment>,
        pub primary_muscles: Vec<ExerciseMuscle>,
        pub secondary_muscles: Vec<ExerciseMuscle>,
        pub instructions: Vec<String>,
        pub category: ExerciseCategory,
        pub images: Vec<String>,
    }
}
