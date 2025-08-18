use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use database_models::{exercise, user_measurement};
use dependent_models::{
    CachedResponse, UpdateCustomExerciseInput, UserExerciseDetails, UserExercisesListResponse,
    UserTemplatesOrWorkoutsListInput, UserWorkoutDetails, UserWorkoutTemplateDetails,
    UserWorkoutsListResponse, UserWorkoutsTemplatesListResponse,
};
use fitness_models::{
    UpdateUserExerciseSettings, UpdateUserWorkoutAttributesInput, UserExercisesListInput,
    UserMeasurementsListInput, UserWorkoutInput,
};
use fitness_service::FitnessService;
use sea_orm::prelude::DateTimeUtc;
use traits::AuthProvider;

#[derive(Default)]
pub struct FitnessQueryResolver;

impl AuthProvider for FitnessQueryResolver {}

#[Object]
impl FitnessQueryResolver {
    /// Get a paginated list of templates created by the user.
    async fn user_workout_templates_list(
        &self,
        gql_ctx: &Context<'_>,
        input: UserTemplatesOrWorkoutsListInput,
    ) -> Result<CachedResponse<UserWorkoutsTemplatesListResponse>> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.user_workout_templates_list(user_id, input).await?;
        Ok(response)
    }

    /// Get information about a workout template.
    async fn user_workout_template_details(
        &self,
        gql_ctx: &Context<'_>,
        workout_template_id: String,
    ) -> Result<UserWorkoutTemplateDetails> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service
            .user_workout_template_details(user_id, workout_template_id)
            .await?;
        Ok(response)
    }

    /// Get a paginated list of exercises in the database.
    async fn user_exercises_list(
        &self,
        gql_ctx: &Context<'_>,
        input: UserExercisesListInput,
    ) -> Result<CachedResponse<UserExercisesListResponse>> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.user_exercises_list(user_id, input).await?;
        Ok(response)
    }

    /// Get a paginated list of workouts done by the user.
    async fn user_workouts_list(
        &self,
        gql_ctx: &Context<'_>,
        input: UserTemplatesOrWorkoutsListInput,
    ) -> Result<CachedResponse<UserWorkoutsListResponse>> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.user_workouts_list(user_id, input).await?;
        Ok(response)
    }

    /// Get details about an exercise.
    async fn exercise_details(
        &self,
        gql_ctx: &Context<'_>,
        exercise_id: String,
    ) -> Result<exercise::Model> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let response = service.exercise_details(exercise_id).await?;
        Ok(response)
    }

    /// Get details about a workout.
    async fn user_workout_details(
        &self,
        gql_ctx: &Context<'_>,
        workout_id: String,
    ) -> Result<UserWorkoutDetails> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.user_workout_details(&user_id, workout_id).await?;
        Ok(response)
    }

    /// Get information about an exercise for a user.
    async fn user_exercise_details(
        &self,
        gql_ctx: &Context<'_>,
        exercise_id: String,
    ) -> Result<UserExerciseDetails> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.user_exercise_details(user_id, exercise_id).await?;
        Ok(response)
    }

    /// Get all the measurements for a user.
    async fn user_measurements_list(
        &self,
        gql_ctx: &Context<'_>,
        input: UserMeasurementsListInput,
    ) -> Result<CachedResponse<Vec<user_measurement::Model>>> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.user_measurements_list(&user_id, input).await?;
        Ok(response)
    }
}

#[derive(Default)]
pub struct FitnessMutationResolver;

impl AuthProvider for FitnessMutationResolver {
    fn is_mutation(&self) -> bool {
        true
    }
}

#[Object]
impl FitnessMutationResolver {
    /// Create or update a workout template.
    async fn create_or_update_user_workout_template(
        &self,
        gql_ctx: &Context<'_>,
        input: UserWorkoutInput,
    ) -> Result<String> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service
            .create_or_update_user_workout_template(user_id, input)
            .await?;
        Ok(response)
    }

    /// Delete a workout template.
    async fn delete_user_workout_template(
        &self,
        gql_ctx: &Context<'_>,
        workout_template_id: String,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service
            .delete_user_workout_template(user_id, workout_template_id)
            .await?;
        Ok(response)
    }

    /// Create a user measurement.
    async fn create_user_measurement(
        &self,
        gql_ctx: &Context<'_>,
        input: user_measurement::Model,
    ) -> Result<DateTimeUtc> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.create_user_measurement(&user_id, input).await?;
        Ok(response)
    }

    /// Delete a user measurement.
    async fn delete_user_measurement(
        &self,
        gql_ctx: &Context<'_>,
        timestamp: DateTimeUtc,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.delete_user_measurement(user_id, timestamp).await?;
        Ok(response)
    }

    /// Take a user workout, process it and commit it to database.
    async fn create_or_update_user_workout(
        &self,
        gql_ctx: &Context<'_>,
        input: UserWorkoutInput,
    ) -> Result<String> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service
            .create_or_update_user_workout(&user_id, input)
            .await?;
        Ok(response)
    }

    /// Change the details about a user's workout.
    async fn update_user_workout_attributes(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateUserWorkoutAttributesInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service
            .update_user_workout_attributes(user_id, input)
            .await?;
        Ok(response)
    }

    /// Delete a workout and remove all exercise associations.
    async fn delete_user_workout(&self, gql_ctx: &Context<'_>, workout_id: String) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.delete_user_workout(user_id, workout_id).await?;
        Ok(response)
    }

    /// Create a custom exercise.
    async fn create_custom_exercise(
        &self,
        gql_ctx: &Context<'_>,
        input: exercise::Model,
    ) -> Result<String> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.create_custom_exercise(&user_id, input).await?;
        Ok(response)
    }

    /// Update a custom exercise.
    async fn update_custom_exercise(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateCustomExerciseInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.update_custom_exercise(user_id, input).await?;
        Ok(response)
    }

    /// Update a user's exercise settings.
    async fn update_user_exercise_settings(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateUserExerciseSettings,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service
            .update_user_exercise_settings(user_id, input)
            .await?;
        Ok(response)
    }

    /// Merge an exercise into another.
    async fn merge_exercise(
        &self,
        gql_ctx: &Context<'_>,
        merge_from: String,
        merge_into: String,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service
            .merge_exercise(user_id, merge_from, merge_into)
            .await?;
        Ok(response)
    }
}
