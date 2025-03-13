use std::collections::HashMap;

use async_graphql::{Enum, InputObject, SimpleObject};
use common_models::{SearchInput, StoredUrl};
use derive_more::with_trait::{Add, AddAssign, Sum};
use educe::Educe;
use enum_models::{
    ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMechanic, ExerciseMuscle,
    WorkoutSetPersonalBest,
};
use rust_decimal::Decimal;
use schematic::{ConfigEnum, Schematic};
use sea_orm::{FromJsonQueryResult, prelude::DateTimeUtc};
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
    Eq,
    Hash,
    Debug,
    Clone,
    Default,
    Serialize,
    PartialEq,
    InputObject,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
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

/// The totals of a workout and the different bests achieved.
#[derive(
    Eq,
    Sum,
    Add,
    Debug,
    Clone,
    Default,
    Serialize,
    PartialEq,
    AddAssign,
    Schematic,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
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
    Eq,
    Clone,
    Debug,
    Default,
    Serialize,
    Schematic,
    PartialEq,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
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
    Eq,
    Enum,
    Copy,
    Clone,
    Debug,
    Default,
    Serialize,
    PartialEq,
    ConfigEnum,
    Deserialize,
    FromJsonQueryResult,
)]
#[serde(rename_all = "snake_case")]
pub enum SetLot {
    #[default]
    Normal,
    WarmUp,
    Drop,
    Failure,
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
    Eq,
    Clone,
    Debug,
    Default,
    Serialize,
    Schematic,
    PartialEq,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
)]
#[serde(rename_all = "snake_case")]
pub struct WorkoutSetRecord {
    pub lot: SetLot,
    pub rpe: Option<u8>,
    pub note: Option<String>,
    pub rest_time: Option<u16>,
    pub statistic: WorkoutSetStatistic,
    pub totals: Option<WorkoutSetTotals>,
    pub confirmed_at: Option<DateTimeUtc>,
    pub rest_timer_started_at: Option<DateTimeUtc>,
    pub personal_bests: Option<Vec<WorkoutSetPersonalBest>>,
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

#[skip_serializing_none]
#[derive(
    Eq,
    Educe,
    Debug,
    Clone,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "SetRestTimersSettingsInput")]
#[educe(Default)]
pub struct SetRestTimersSettings {
    pub drop: Option<u16>,
    pub warmup: Option<u16>,
    #[educe(Default = Some(60))]
    pub normal: Option<u16>,
    pub failure: Option<u16>,
}

#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "UserToExerciseSettingsExtraInformationInput")]
pub struct UserToExerciseSettingsExtraInformation {
    pub exclude_from_analytics: bool,
    pub set_rest_timers: SetRestTimersSettings,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, FromJsonQueryResult, Eq, PartialEq, SimpleObject, Default,
)]
pub struct UserToExerciseExtraInformation {
    pub lifetime_stats: WorkoutOrExerciseTotals,
    pub settings: UserToExerciseSettingsExtraInformation,
    pub history: Vec<UserToExerciseHistoryExtraInformation>,
    pub personal_bests: Vec<UserToExerciseBestSetExtraInformation>,
}

/// The assets that were uploaded for an entity.
#[derive(
    Eq,
    Clone,
    Debug,
    Default,
    Schematic,
    PartialEq,
    Serialize,
    InputObject,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
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
    Eq,
    Clone,
    Debug,
    Default,
    Schematic,
    Serialize,
    PartialEq,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
)]
#[serde(rename_all = "snake_case")]
pub struct ProcessedExercise {
    pub id: String,
    pub lot: ExerciseLot,
    pub notes: Vec<String>,
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
    InputObject,
)]
#[serde(rename_all = "snake_case")]
#[graphql(input_name = "WorkoutSupersetsInformationInput")]
pub struct WorkoutSupersetsInformation {
    /// A color that will be displayed on the frontend.
    pub color: String,
    /// The identifier of all the exercises which are in the same superset
    pub exercises: Vec<u16>,
}

/// Information about a workout done.
#[skip_serializing_none]
#[derive(
    Eq,
    Clone,
    Debug,
    Default,
    PartialEq,
    Schematic,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[serde(rename_all = "snake_case")]
#[graphql(input_name = "WorkoutDurationInput")]
pub struct WorkoutDuration {
    pub from: DateTimeUtc,
    pub to: Option<DateTimeUtc>,
}

/// Information about a workout done.
#[skip_serializing_none]
#[derive(
    Eq,
    Clone,
    Debug,
    Default,
    PartialEq,
    Schematic,
    Serialize,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
)]
#[serde(rename_all = "snake_case")]
pub struct WorkoutInformation {
    pub comment: Option<String>,
    pub assets: Option<EntityAssets>,
    pub exercises: Vec<ProcessedExercise>,
    pub durations: Option<Vec<WorkoutDuration>>,
    pub supersets: Vec<WorkoutSupersetsInformation>,
}

/// The summary about an exercise done in a workout.
#[skip_serializing_none]
#[derive(
    Eq,
    Clone,
    Debug,
    Default,
    Serialize,
    Schematic,
    PartialEq,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
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
    Default,
    SimpleObject,
    Schematic,
)]
pub struct WorkoutLotFocusedSummary {
    pub lot: ExerciseLot,
    pub exercises: Vec<usize>,
}

#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    Default,
    SimpleObject,
    Schematic,
)]
pub struct WorkoutLevelFocusedSummary {
    pub level: ExerciseLevel,
    pub exercises: Vec<usize>,
}

#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    Default,
    SimpleObject,
    Schematic,
)]
pub struct WorkoutEquipmentFocusedSummary {
    pub exercises: Vec<usize>,
    pub equipment: ExerciseEquipment,
}

#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    Default,
    SimpleObject,
    Schematic,
)]
pub struct WorkoutForceFocusedSummary {
    pub force: ExerciseForce,
    pub exercises: Vec<usize>,
}

#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    Default,
    SimpleObject,
    Schematic,
)]
pub struct WorkoutMuscleFocusedSummary {
    pub exercises: Vec<usize>,
    pub muscle: ExerciseMuscle,
}

#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    Default,
    SimpleObject,
    Schematic,
)]
#[serde(rename_all = "snake_case")]
pub struct WorkoutFocusedSummary {
    pub lots: Vec<WorkoutLotFocusedSummary>,
    pub levels: Vec<WorkoutLevelFocusedSummary>,
    pub forces: Vec<WorkoutForceFocusedSummary>,
    pub muscles: Vec<WorkoutMuscleFocusedSummary>,
    pub equipments: Vec<WorkoutEquipmentFocusedSummary>,
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
    Default,
    SimpleObject,
    Schematic,
)]
#[serde(rename_all = "snake_case")]
pub struct WorkoutSummary {
    pub focused: WorkoutFocusedSummary,
    // DEV: This is nullable because it is also used for the workout templates
    pub total: Option<WorkoutOrExerciseTotals>,
    pub exercises: Vec<WorkoutSummaryExercise>,
}

#[derive(Debug, Default, Serialize, Deserialize, InputObject, Clone)]
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
    pub assets: Option<EntityAssets>,
    pub sets: Vec<UserWorkoutSetRecord>,
}

#[derive(Clone, Default, Debug, Deserialize, Serialize, InputObject)]
pub struct UserWorkoutInput {
    pub name: String,
    pub end_time: DateTimeUtc,
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
    pub durations: Option<Vec<WorkoutDuration>>,
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
