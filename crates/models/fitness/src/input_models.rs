use async_graphql::{Enum, InputObject};
use common_models::{EntityAssets, SearchInput};
use enum_models::{
    ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMechanic, ExerciseMuscle,
};
use rust_decimal::Decimal;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};

use crate::{
    SetLot, UserToExerciseSettingsExtraInformation, UserUnitSystem, WorkoutSetStatistic,
    WorkoutSupersetsInformation,
};

#[derive(Debug, Default, Serialize, Deserialize, InputObject, Clone, PartialEq, Eq, Hash)]
pub struct UserMeasurementsListInput {
    pub start_time: Option<DateTimeUtc>,
    pub end_time: Option<DateTimeUtc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, InputObject, Default)]
pub struct UserWorkoutSetRecord {
    pub lot: SetLot,
    pub rpe: Option<u8>,
    pub note: Option<String>,
    pub rest_time: Option<u16>,
    pub statistic: WorkoutSetStatistic,
    pub confirmed_at: Option<DateTimeUtc>,
    pub rest_timer_started_at: Option<DateTimeUtc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, InputObject, Default)]
pub struct UserExerciseInput {
    pub notes: Vec<String>,
    pub exercise_id: String,
    pub unit_system: UserUnitSystem,
    pub assets: Option<EntityAssets>,
    pub sets: Vec<UserWorkoutSetRecord>,
}

#[derive(Clone, Default, Debug, Deserialize, Serialize, InputObject)]
pub struct UserWorkoutInput {
    pub name: String,
    pub end_time: DateTimeUtc,
    pub duration: Option<i64>,
    pub comment: Option<String>,
    pub start_time: DateTimeUtc,
    pub template_id: Option<String>,
    pub assets: Option<EntityAssets>,
    pub repeated_from: Option<String>,
    pub calories_burnt: Option<Decimal>,
    // If specified, the workout will be created with this ID.
    #[graphql(skip_input)]
    pub create_workout_id: Option<String>,
    pub exercises: Vec<UserExerciseInput>,
    pub update_workout_id: Option<String>,
    pub update_workout_template_id: Option<String>,
    pub supersets: Vec<WorkoutSupersetsInformation>,
}

#[derive(Debug, Hash, PartialEq, Eq, Serialize, Deserialize, InputObject, Clone)]
pub struct ExerciseListFilter {
    #[graphql(name = "type")]
    pub lot: Option<ExerciseLot>,
    pub level: Option<ExerciseLevel>,
    pub force: Option<ExerciseForce>,
    pub mechanic: Option<ExerciseMechanic>,
    pub equipment: Option<ExerciseEquipment>,
    pub muscle: Option<ExerciseMuscle>,
    pub collection: Option<String>,
}

#[derive(Debug, Hash, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
pub enum ExerciseSortBy {
    Name,
    Random,
    #[default]
    LastPerformed,
    TimesPerformed,
}

#[derive(Debug, Hash, PartialEq, Eq, Serialize, Deserialize, InputObject, Clone, Default)]
pub struct UserExercisesListInput {
    pub search: SearchInput,
    pub sort_by: Option<ExerciseSortBy>,
    pub filter: Option<ExerciseListFilter>,
}

#[derive(Debug, InputObject)]
pub struct UpdateUserExerciseSettings {
    pub exercise_id: String,
    pub change: UserToExerciseSettingsExtraInformation,
}

#[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
pub struct UpdateUserWorkoutAttributesInput {
    pub id: String,
    pub start_time: Option<DateTimeUtc>,
    pub end_time: Option<DateTimeUtc>,
}
