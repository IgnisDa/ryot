use async_graphql::{Enum, SimpleObject};
use enum_models::{
    ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseMechanic, ExerciseMuscle,
};
use sea_orm::FromJsonQueryResult;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Enum, Copy, Deserialize, FromJsonQueryResult, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ExerciseCategory {
    Powerlifting,
    Strength,
    Stretching,
    Cardio,
    #[serde(alias = "olympic weightlifting")]
    OlympicWeightlifting,
    Strongman,
    Plyometrics,
}

#[derive(
    Debug, Clone, Serialize, SimpleObject, Deserialize, FromJsonQueryResult, Eq, PartialEq,
)]
#[serde(rename_all = "camelCase")]
pub struct GithubExerciseAttributes {
    pub level: ExerciseLevel,
    pub category: ExerciseCategory,
    pub force: Option<ExerciseForce>,
    pub mechanic: Option<ExerciseMechanic>,
    pub equipment: Option<ExerciseEquipment>,
    pub primary_muscles: Vec<ExerciseMuscle>,
    pub secondary_muscles: Vec<ExerciseMuscle>,
    pub instructions: Vec<String>,
    #[serde(default)]
    pub images: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromJsonQueryResult, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GithubExercise {
    #[serde(flatten)]
    pub attributes: GithubExerciseAttributes,
    pub name: String,
}
