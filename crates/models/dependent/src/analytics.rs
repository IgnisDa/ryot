use async_graphql::SimpleObject;
use chrono::NaiveDate;
use common_models::{DailyUserActivitiesResponseGroupedBy, DailyUserActivityHourRecord};
use enum_models::{ExerciseEquipment, ExerciseMuscle};
use sea_orm::{FromJsonQueryResult, FromQueryResult};
use serde::{Deserialize, Serialize};

#[derive(
    Debug, Default, SimpleObject, Serialize, Deserialize, Clone, FromQueryResult, PartialEq, Eq,
)]
pub struct DailyUserActivityItem {
    pub day: NaiveDate,
    pub total_metadata_review_count: i64,
    pub total_collection_review_count: i64,
    pub total_metadata_group_review_count: i64,
    pub total_person_review_count: i64,
    pub user_measurement_count: i64,
    pub workout_count: i64,
    pub total_workout_duration: i64,
    pub audio_book_count: i64,
    pub total_audio_book_duration: i64,
    pub anime_count: i64,
    pub book_count: i64,
    pub total_book_pages: i64,
    pub podcast_count: i64,
    pub total_podcast_duration: i64,
    pub manga_count: i64,
    pub movie_count: i64,
    pub total_movie_duration: i64,
    pub music_count: i64,
    pub total_music_duration: i64,
    pub show_count: i64,
    pub total_show_duration: i64,
    pub video_game_count: i64,
    pub total_video_game_duration: i64,
    pub comic_book_count: i64,
    pub visual_novel_count: i64,
    pub total_visual_novel_duration: i64,
    pub total_workout_personal_bests: i64,
    pub total_workout_weight: i64,
    pub total_workout_reps: i64,
    pub total_workout_distance: i64,
    pub total_workout_rest_time: i64,
    pub total_metadata_count: i64,
    pub total_review_count: i64,
    pub total_count: i64,
    pub total_duration: i64,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone, PartialEq, Eq)]
pub struct DailyUserActivitiesResponse {
    pub total_count: i64,
    pub item_count: usize,
    pub total_duration: i64,
    pub items: Vec<DailyUserActivityItem>,
    pub grouped_by: DailyUserActivitiesResponseGroupedBy,
}

#[derive(
    Debug, SimpleObject, Serialize, Deserialize, FromJsonQueryResult, Clone, Eq, PartialEq,
)]
pub struct FitnessAnalyticsExercise {
    pub count: u32,
    pub exercise: String,
}

#[derive(
    Debug, SimpleObject, Serialize, Deserialize, FromJsonQueryResult, Clone, Eq, PartialEq,
)]
pub struct FitnessAnalyticsMuscle {
    pub count: u32,
    pub muscle: ExerciseMuscle,
}

#[derive(
    Debug, SimpleObject, Serialize, Deserialize, FromJsonQueryResult, Clone, Eq, PartialEq,
)]
pub struct FitnessAnalyticsEquipment {
    pub count: u32,
    pub equipment: ExerciseEquipment,
}

#[derive(
    Debug, SimpleObject, Serialize, Deserialize, FromJsonQueryResult, Clone, Eq, PartialEq,
)]
pub struct UserFitnessAnalytics {
    pub workout_reps: i32,
    pub workout_weight: i32,
    pub workout_count: i32,
    pub workout_distance: i32,
    pub workout_duration: i32,
    pub workout_rest_time: i32,
    pub measurement_count: i32,
    pub workout_calories_burnt: i32,
    pub workout_personal_bests: i32,
    pub workout_muscles: Vec<FitnessAnalyticsMuscle>,
    pub workout_exercises: Vec<FitnessAnalyticsExercise>,
    pub workout_equipments: Vec<FitnessAnalyticsEquipment>,
}

#[derive(
    Debug, SimpleObject, Serialize, Deserialize, FromJsonQueryResult, Clone, Eq, PartialEq,
)]
pub struct UserAnalytics {
    pub fitness: UserFitnessAnalytics,
    pub activities: DailyUserActivitiesResponse,
    pub hours: Vec<DailyUserActivityHourRecord>,
}
