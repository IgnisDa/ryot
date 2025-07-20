use std::sync::Arc;

use anyhow::Result;
use database_models::{exercise, user_measurement};
use dependent_models::{
    CachedResponse, UpdateCustomExerciseInput, UserExerciseDetails, UserExercisesListResponse,
    UserMeasurementsListResponse, UserTemplatesOrWorkoutsListInput, UserWorkoutDetails,
    UserWorkoutTemplateDetails, UserWorkoutsListResponse, UserWorkoutsTemplatesListResponse,
};
use fitness_models::{
    UpdateUserExerciseSettings, UpdateUserWorkoutAttributesInput, UserExercisesListInput,
    UserMeasurementsListInput, UserWorkoutInput,
};
use sea_orm::prelude::DateTimeUtc;
use supporting_service::SupportingService;

mod exercise_management;
pub use exercise_management::*;

mod measurement_operations;
pub use measurement_operations::*;

mod system_operations;
pub use system_operations::*;

mod template_management;
pub use template_management::*;

mod workout_operations;
pub use workout_operations::*;

const EXERCISE_DB_URL: &str = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main";
const JSON_URL: &str = const_str::concat!(EXERCISE_DB_URL, "/dist/exercises.json");
const IMAGES_PREFIX_URL: &str = const_str::concat!(EXERCISE_DB_URL, "/exercises");

pub struct FitnessService(pub Arc<SupportingService>);

impl FitnessService {
    // Template management methods delegated to template_management module
    pub async fn user_workout_templates_list(
        &self,
        user_id: String,
        input: UserTemplatesOrWorkoutsListInput,
    ) -> Result<CachedResponse<UserWorkoutsTemplatesListResponse>> {
        template_management::user_workout_templates_list(&self.0, user_id, input).await
    }

    pub async fn user_workout_template_details(
        &self,
        user_id: String,
        workout_template_id: String,
    ) -> Result<UserWorkoutTemplateDetails> {
        template_management::user_workout_template_details(&self.0, user_id, workout_template_id)
            .await
    }

    pub async fn create_or_update_user_workout_template(
        &self,
        user_id: String,
        input: UserWorkoutInput,
    ) -> Result<String> {
        template_management::create_or_update_user_workout_template(&self.0, user_id, input).await
    }

    pub async fn delete_user_workout_template(
        &self,
        user_id: String,
        workout_template_id: String,
    ) -> Result<bool> {
        template_management::delete_user_workout_template(&self.0, user_id, workout_template_id)
            .await
    }

    // Exercise management methods delegated to exercise_management module
    pub async fn exercise_details(&self, exercise_id: String) -> Result<exercise::Model> {
        exercise_management::exercise_details(&self.0, exercise_id).await
    }

    pub async fn user_exercise_details(
        &self,
        user_id: String,
        exercise_id: String,
    ) -> Result<UserExerciseDetails> {
        exercise_management::user_exercise_details(&self.0, user_id, exercise_id).await
    }

    pub async fn user_exercises_list(
        &self,
        user_id: String,
        input: UserExercisesListInput,
    ) -> Result<CachedResponse<UserExercisesListResponse>> {
        exercise_management::user_exercises_list(&self.0, user_id, input).await
    }

    pub async fn create_custom_exercise(
        &self,
        user_id: &String,
        input: exercise::Model,
    ) -> Result<String> {
        exercise_management::create_custom_exercise(&self.0, user_id, input).await
    }

    pub async fn update_custom_exercise(
        &self,
        user_id: String,
        input: UpdateCustomExerciseInput,
    ) -> Result<bool> {
        exercise_management::update_custom_exercise(&self.0, user_id, input).await
    }

    pub async fn update_user_exercise_settings(
        &self,
        user_id: String,
        input: UpdateUserExerciseSettings,
    ) -> Result<bool> {
        exercise_management::update_user_exercise_settings(&self.0, user_id, input).await
    }

    pub async fn merge_exercise(
        &self,
        user_id: String,
        merge_from: String,
        merge_into: String,
    ) -> Result<bool> {
        exercise_management::merge_exercise(&self.0, user_id, merge_from, merge_into).await
    }

    // Workout operations methods delegated to workout_operations module
    pub async fn user_workout_details(
        &self,
        user_id: &String,
        workout_id: String,
    ) -> Result<UserWorkoutDetails> {
        workout_operations::user_workout_details(&self.0, user_id, workout_id).await
    }

    pub async fn user_workouts_list(
        &self,
        user_id: String,
        input: UserTemplatesOrWorkoutsListInput,
    ) -> Result<CachedResponse<UserWorkoutsListResponse>> {
        workout_operations::user_workouts_list(&self.0, user_id, input).await
    }

    pub async fn create_or_update_user_workout(
        &self,
        user_id: &String,
        input: UserWorkoutInput,
    ) -> Result<String> {
        workout_operations::create_or_update_user_workout(&self.0, user_id, input).await
    }

    pub async fn update_user_workout_attributes(
        &self,
        user_id: String,
        input: UpdateUserWorkoutAttributesInput,
    ) -> Result<bool> {
        workout_operations::update_user_workout_attributes(&self.0, user_id, input).await
    }

    pub async fn delete_user_workout(&self, user_id: String, workout_id: String) -> Result<bool> {
        workout_operations::delete_user_workout(&self.0, user_id, workout_id).await
    }

    pub async fn revise_user_workouts(&self, user_id: String) -> Result<()> {
        workout_operations::revise_user_workouts(&self.0, user_id).await
    }

    // Measurement operations methods delegated to measurement_operations module
    pub async fn user_measurements_list(
        &self,
        user_id: &String,
        input: UserMeasurementsListInput,
    ) -> Result<CachedResponse<UserMeasurementsListResponse>> {
        measurement_operations::user_measurements_list(&self.0, user_id, input).await
    }

    pub async fn create_user_measurement(
        &self,
        user_id: &String,
        input: user_measurement::Model,
    ) -> Result<DateTimeUtc> {
        measurement_operations::create_user_measurement(&self.0, user_id, input).await
    }

    pub async fn delete_user_measurement(
        &self,
        user_id: String,
        timestamp: DateTimeUtc,
    ) -> Result<bool> {
        measurement_operations::delete_user_measurement(&self.0, &user_id, timestamp).await
    }

    // System operations methods delegated to system_operations module
    pub async fn deploy_update_exercise_library_job(&self) -> Result<()> {
        system_operations::deploy_update_exercise_library_job(&self.0).await
    }

    pub async fn update_github_exercises(&self) -> Result<()> {
        system_operations::update_github_exercises(&self.0).await
    }

    pub async fn process_users_scheduled_for_workout_revision(&self) -> Result<()> {
        system_operations::process_users_scheduled_for_workout_revision(&self.0).await
    }
}
