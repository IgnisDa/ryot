use std::{collections::HashMap, sync::Arc};

use application_utils::GraphqlRepresentation;
use async_graphql::{Enum, InputObject, Result as GraphqlResult, SimpleObject};
use async_trait::async_trait;
use common_models::{SearchInput, StoredUrl};
use derive_more::{Add, AddAssign, Sum};
use enums::{
    ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMechanic, ExerciseMuscle,
};
use file_storage_service::FileStorageService;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use schematic::{ConfigEnum, Schematic};
use sea_orm::{prelude::DateTimeUtc, FromJsonQueryResult, FromQueryResult};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

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
    Debug,
    Clone,
    Serialize,
    SimpleObject,
    Deserialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    InputObject,
)]
#[serde(rename_all = "camelCase")]
#[graphql(input_name = "ExerciseAttributesInput")]
pub struct ExerciseAttributes {
    pub instructions: Vec<String>,
    #[graphql(skip)]
    #[serde(default)]
    pub internal_images: Vec<StoredUrl>,
    #[serde(default)]
    pub images: Vec<String>,
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
    #[serde(alias = "id")]
    pub identifier: String,
    #[serde(flatten)]
    pub attributes: GithubExerciseAttributes,
    pub name: String,
}

/// The actual statistics that were logged in a user measurement.
#[skip_serializing_none]
#[derive(
    Debug,
    Clone,
    Serialize,
    Deserialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    SimpleObject,
    InputObject,
    Schematic,
    Default,
)]
#[graphql(input_name = "UserMeasurementDataInput")]
#[serde(rename_all = "snake_case")]
pub struct UserMeasurementStats {
    pub weight: Option<Decimal>,
    pub body_mass_index: Option<Decimal>,
    pub total_body_water: Option<Decimal>,
    pub muscle: Option<Decimal>,
    pub lean_body_mass: Option<Decimal>,
    pub body_fat: Option<Decimal>,
    pub bone_mass: Option<Decimal>,
    pub visceral_fat: Option<Decimal>,
    pub waist_circumference: Option<Decimal>,
    pub waist_to_height_ratio: Option<Decimal>,
    pub hip_circumference: Option<Decimal>,
    pub waist_to_hip_ratio: Option<Decimal>,
    pub chest_circumference: Option<Decimal>,
    pub thigh_circumference: Option<Decimal>,
    pub biceps_circumference: Option<Decimal>,
    pub neck_circumference: Option<Decimal>,
    pub body_fat_caliper: Option<Decimal>,
    pub chest_skinfold: Option<Decimal>,
    pub abdominal_skinfold: Option<Decimal>,
    pub thigh_skinfold: Option<Decimal>,
    pub basal_metabolic_rate: Option<Decimal>,
    pub total_daily_energy_expenditure: Option<Decimal>,
    pub calories: Option<Decimal>,
    // DEV: The only custom data type we allow is decimal
    pub custom: Option<HashMap<String, Decimal>>,
}

#[derive(Clone, Debug, Deserialize, SimpleObject, FromQueryResult)]
pub struct ExerciseListItem {
    pub lot: ExerciseLot,
    pub id: String,
    #[graphql(skip)]
    pub attributes: ExerciseAttributes,
    pub num_times_interacted: Option<i32>,
    pub last_updated_on: Option<DateTimeUtc>,
    pub muscle: Option<ExerciseMuscle>,
    pub image: Option<String>,
    #[graphql(skip)]
    pub muscles: Vec<ExerciseMuscle>,
}

#[async_trait]
impl GraphqlRepresentation for ExerciseListItem {
    async fn graphql_representation(
        self,
        file_storage_service: &Arc<FileStorageService>,
    ) -> GraphqlResult<Self> {
        let mut converted_exercise = self.clone();
        if let Some(img) = self.attributes.internal_images.first() {
            converted_exercise.image =
                Some(file_storage_service.get_stored_asset(img.clone()).await)
        }
        converted_exercise.muscle = self.muscles.first().cloned();
        Ok(converted_exercise)
    }
}

/// The totals of a workout and the different bests achieved.
#[derive(
    Debug,
    FromJsonQueryResult,
    Clone,
    Serialize,
    Deserialize,
    Eq,
    PartialEq,
    SimpleObject,
    Default,
    Sum,
    Add,
    AddAssign,
    Schematic,
)]
#[serde(rename_all = "snake_case")]
pub struct WorkoutOrExerciseTotals {
    /// The number of personal bests achieved.
    pub personal_bests_achieved: usize,
    pub weight: Decimal,
    pub reps: Decimal,
    pub distance: Decimal,
    pub duration: Decimal,
    /// The total seconds that were logged in the rest timer.
    #[serde(default)]
    pub rest_time: u16,
}

#[skip_serializing_none]
#[derive(
    Debug, Clone, Serialize, Deserialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject, Default,
)]
pub struct UserToExerciseHistoryExtraInformation {
    pub idx: usize,
    pub workout_id: String,
    pub workout_end_on: DateTimeUtc,
    pub best_set: Option<WorkoutSetRecord>,
}

/// Details about the statistics of the set performed.
#[skip_serializing_none]
#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    SimpleObject,
    InputObject,
    Schematic,
    Default,
)]
#[graphql(input_name = "SetStatisticInput")]
#[serde(rename_all = "snake_case")]
pub struct WorkoutSetStatistic {
    pub duration: Option<Decimal>,
    pub distance: Option<Decimal>,
    pub reps: Option<Decimal>,
    pub weight: Option<Decimal>,
    pub one_rm: Option<Decimal>,
    pub pace: Option<Decimal>,
    pub volume: Option<Decimal>,
}

/// The types of set (mostly characterized by exertion level).
#[derive(
    Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, Enum, Copy, ConfigEnum,
)]
#[serde(rename_all = "snake_case")]
pub enum SetLot {
    Normal,
    WarmUp,
    Drop,
    Failure,
}

/// The different types of personal bests that can be achieved on a set.
#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    Enum,
    Copy,
    Default,
    ConfigEnum,
)]
#[serde(rename_all = "snake_case")]
pub enum WorkoutSetPersonalBest {
    #[default]
    Weight,
    OneRm,
    Volume,
    Time,
    Pace,
    Reps,
}

#[skip_serializing_none]
#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    SimpleObject,
    Schematic,
    Default,
)]
#[serde(rename_all = "snake_case")]
pub struct WorkoutSetTotals {
    pub weight: Option<Decimal>,
}

/// Details about the set performed.
#[skip_serializing_none]
#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    SimpleObject,
    Schematic,
)]
#[serde(rename_all = "snake_case")]
pub struct WorkoutSetRecord {
    pub lot: SetLot,
    pub note: Option<String>,
    pub actual_rest_time: Option<i64>,
    pub statistic: WorkoutSetStatistic,
    pub totals: Option<WorkoutSetTotals>,
    pub confirmed_at: Option<DateTimeUtc>,
    pub personal_bests: Option<Vec<WorkoutSetPersonalBest>>,
}

impl WorkoutSetRecord {
    // DEV: Formula from https://en.wikipedia.org/wiki/One-repetition_maximum#cite_note-7
    pub fn calculate_one_rm(&self) -> Option<Decimal> {
        let mut val =
            (self.statistic.weight? * dec!(36.0)).checked_div(dec!(37.0) - self.statistic.reps?);
        if let Some(v) = val {
            if v <= dec!(0) {
                val = None;
            }
        };
        val
    }

    pub fn calculate_volume(&self) -> Option<Decimal> {
        Some(self.statistic.weight? * self.statistic.reps?)
    }

    pub fn calculate_pace(&self) -> Option<Decimal> {
        self.statistic
            .distance?
            .checked_div(self.statistic.duration?)
    }

    pub fn get_personal_best(&self, pb_type: &WorkoutSetPersonalBest) -> Option<Decimal> {
        match pb_type {
            WorkoutSetPersonalBest::Weight => self.statistic.weight,
            WorkoutSetPersonalBest::Time => self.statistic.duration,
            WorkoutSetPersonalBest::Reps => self.statistic.reps,
            WorkoutSetPersonalBest::OneRm => self.calculate_one_rm(),
            WorkoutSetPersonalBest::Volume => self.calculate_volume(),
            WorkoutSetPersonalBest::Pace => self.calculate_pace(),
        }
    }
}

#[derive(
    Clone, Debug, Deserialize, Serialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject,
)]
pub struct ExerciseBestSetRecord {
    pub workout_id: String,
    pub exercise_idx: usize,
    pub set_idx: usize,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject, Default,
)]
pub struct UserToExerciseBestSetExtraInformation {
    pub lot: WorkoutSetPersonalBest,
    pub sets: Vec<ExerciseBestSetRecord>,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject, Default,
)]
pub struct UserToExerciseExtraInformation {
    pub history: Vec<UserToExerciseHistoryExtraInformation>,
    pub lifetime_stats: WorkoutOrExerciseTotals,
    pub personal_bests: Vec<UserToExerciseBestSetExtraInformation>,
}

/// The assets that were uploaded for an entity.
#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    SimpleObject,
    InputObject,
    Default,
    Schematic,
)]
#[graphql(input_name = "EntityAssetsInput")]
#[serde(rename_all = "snake_case")]
pub struct EntityAssets {
    /// The keys of the S3 images.
    pub images: Vec<String>,
    /// The keys of the S3 videos.
    pub videos: Vec<String>,
}

/// An exercise that has been processed and committed to the database.
#[skip_serializing_none]
#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    SimpleObject,
    Schematic,
)]
#[serde(rename_all = "snake_case")]
pub struct ProcessedExercise {
    pub name: String,
    pub lot: ExerciseLot,
    pub notes: Vec<String>,
    pub rest_time: Option<u16>,
    /// The indices of the exercises with which this has been superset with.
    pub superset_with: Vec<u16>,
    pub sets: Vec<WorkoutSetRecord>,
    pub assets: Option<EntityAssets>,
    pub total: Option<WorkoutOrExerciseTotals>,
}

#[derive(
    Debug,
    Serialize,
    Deserialize,
    Enum,
    Clone,
    Eq,
    PartialEq,
    FromJsonQueryResult,
    Copy,
    Default,
    ConfigEnum,
)]
pub enum UserUnitSystem {
    #[default]
    Metric,
    Imperial,
}

/// Information about a workout done.
#[skip_serializing_none]
#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    SimpleObject,
    Schematic,
)]
#[serde(rename_all = "snake_case")]
pub struct WorkoutInformation {
    pub comment: Option<String>,
    pub assets: Option<EntityAssets>,
    pub exercises: Vec<ProcessedExercise>,
}

/// The summary about an exercise done in a workout.
#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    SimpleObject,
    Schematic,
)]
#[serde(rename_all = "snake_case")]
pub struct WorkoutSummaryExercise {
    pub id: String,
    pub num_sets: usize,
    pub lot: Option<ExerciseLot>,
    pub best_set: Option<WorkoutSetRecord>,
}

#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    SimpleObject,
    Schematic,
)]
#[serde(rename_all = "snake_case")]
pub struct WorkoutSummary {
    // DEV: This is nullable because it is also used for the workout templates
    pub total: Option<WorkoutOrExerciseTotals>,
    pub exercises: Vec<WorkoutSummaryExercise>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct UserMeasurementsListInput {
    pub start_time: Option<DateTimeUtc>,
    pub end_time: Option<DateTimeUtc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
pub struct UserWorkoutSetRecord {
    pub lot: SetLot,
    pub note: Option<String>,
    pub statistic: WorkoutSetStatistic,
    pub confirmed_at: Option<DateTimeUtc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
pub struct UserExerciseInput {
    pub exercise_id: String,
    pub sets: Vec<UserWorkoutSetRecord>,
    pub notes: Vec<String>,
    pub rest_time: Option<u16>,
    pub assets: Option<EntityAssets>,
    pub superset_with: Vec<u16>,
}

#[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
pub struct UserWorkoutInput {
    pub name: String,
    // If specified, the workout will be created with this ID.
    #[graphql(skip_input)]
    pub id: Option<String>,
    pub end_time: DateTimeUtc,
    pub comment: Option<String>,
    pub start_time: DateTimeUtc,
    pub assets: Option<EntityAssets>,
    pub repeated_from: Option<String>,
    pub exercises: Vec<UserExerciseInput>,
}

impl UserWorkoutSetRecord {
    /// Set the invalid statistics to `None` according to the type of exercise.
    pub fn remove_invalids(&mut self, exercise_lot: &ExerciseLot) {
        let mut stats = WorkoutSetStatistic {
            ..Default::default()
        };
        match exercise_lot {
            ExerciseLot::Duration => stats.duration = self.statistic.duration,
            ExerciseLot::DistanceAndDuration => {
                stats.distance = self.statistic.distance;
                stats.duration = self.statistic.duration;
            }
            ExerciseLot::RepsAndWeight => {
                stats.reps = self.statistic.reps;
                stats.weight = self.statistic.weight;
            }
            ExerciseLot::Reps => {
                stats.reps = self.statistic.reps;
            }
        }
        self.statistic = stats;
    }
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
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

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
pub enum ExerciseSortBy {
    Name,
    #[default]
    LastPerformed,
    TimesPerformed,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct ExercisesListInput {
    pub search: SearchInput,
    pub filter: Option<ExerciseListFilter>,
    pub sort_by: Option<ExerciseSortBy>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct ExerciseParametersLotMapping {
    pub lot: ExerciseLot,
    pub bests: Vec<WorkoutSetPersonalBest>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct ExerciseParameters {
    /// All filters applicable to an exercises query.
    pub filters: ExerciseFilters,
    pub download_required: bool,
    /// Exercise type mapped to the personal bests possible.
    pub lot_mapping: Vec<ExerciseParametersLotMapping>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct ExerciseFilters {
    #[graphql(name = "type")]
    pub lot: Vec<ExerciseLot>,
    pub level: Vec<ExerciseLevel>,
    pub force: Vec<ExerciseForce>,
    pub mechanic: Vec<ExerciseMechanic>,
    pub equipment: Vec<ExerciseEquipment>,
    pub muscle: Vec<ExerciseMuscle>,
}

#[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
pub struct UpdateUserWorkoutInput {
    pub id: String,
    pub start_time: Option<DateTimeUtc>,
    pub end_time: Option<DateTimeUtc>,
}
