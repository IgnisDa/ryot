use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use common_models::SearchInput;
use database_models::{exercise, user_measurement};
use dependent_models::{
    SearchResults, UpdateCustomExerciseInput, UserExerciseDetails, UserWorkoutDetails,
    UserWorkoutTemplateDetails,
};
use fitness_models::{
    ExercisesListInput, UpdateUserExerciseSettings, UpdateUserWorkoutAttributesInput,
    UserMeasurementsListInput, UserWorkoutInput,
};
use fitness_service::FitnessService;
use sea_orm::prelude::DateTimeUtc;
use traits::AuthProvider;

#[derive(Default)]
pub struct FitnessQuery;

impl AuthProvider for FitnessQuery {}

#[Object]
impl FitnessQuery {
    /// Get a paginated list of templates created by the user.
    async fn user_workout_templates_list(
        &self,
        gql_ctx: &Context<'_>,
        input: SearchInput,
    ) -> Result<SearchResults<String>> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.user_workout_templates_list(user_id, input).await
    }

    /// Get information about a workout template.
    async fn user_workout_template_details(
        &self,
        gql_ctx: &Context<'_>,
        workout_template_id: String,
    ) -> Result<UserWorkoutTemplateDetails> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service
            .user_workout_template_details(user_id, workout_template_id)
            .await
    }

    /// Get a paginated list of exercises in the database.
    async fn exercises_list(
        &self,
        gql_ctx: &Context<'_>,
        input: ExercisesListInput,
    ) -> Result<SearchResults<String>> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.exercises_list(user_id, input).await
    }

    /// Get a paginated list of workouts done by the user.
    async fn user_workouts_list(
        &self,
        gql_ctx: &Context<'_>,
        input: SearchInput,
    ) -> Result<SearchResults<String>> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.user_workouts_list(user_id, input).await
    }

    /// Get details about an exercise.
    async fn exercise_details(
        &self,
        gql_ctx: &Context<'_>,
        exercise_id: String,
    ) -> Result<exercise::Model> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        service.exercise_details(exercise_id).await
    }

    /// Get details about a workout.
    async fn user_workout_details(
        &self,
        gql_ctx: &Context<'_>,
        workout_id: String,
    ) -> Result<UserWorkoutDetails> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.user_workout_details(&user_id, workout_id).await
    }

    /// Get information about an exercise for a user.
    async fn user_exercise_details(
        &self,
        gql_ctx: &Context<'_>,
        exercise_id: String,
    ) -> Result<UserExerciseDetails> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.user_exercise_details(user_id, exercise_id).await
    }

    /// Get all the measurements for a user.
    async fn user_measurements_list(
        &self,
        gql_ctx: &Context<'_>,
        input: UserMeasurementsListInput,
    ) -> Result<Vec<user_measurement::Model>> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.user_measurements_list(&user_id, input).await
    }
}

#[derive(Default)]
pub struct FitnessMutation;

impl AuthProvider for FitnessMutation {
    fn is_mutation(&self) -> bool {
        true
    }
}

#[Object]
impl FitnessMutation {
    /// Create or update a workout template.
    async fn create_or_update_user_workout_template(
        &self,
        gql_ctx: &Context<'_>,
        input: UserWorkoutInput,
    ) -> Result<String> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service
            .create_or_update_user_workout_template(user_id, input)
            .await
    }

    /// Delete a workout template.
    async fn delete_user_workout_template(
        &self,
        gql_ctx: &Context<'_>,
        workout_template_id: String,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service
            .delete_user_workout_template(user_id, workout_template_id)
            .await
    }

    /// Create a user measurement.
    async fn create_user_measurement(
        &self,
        gql_ctx: &Context<'_>,
        input: user_measurement::Model,
    ) -> Result<DateTimeUtc> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.create_user_measurement(&user_id, input).await
    }

    /// Delete a user measurement.
    async fn delete_user_measurement(
        &self,
        gql_ctx: &Context<'_>,
        timestamp: DateTimeUtc,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.delete_user_measurement(user_id, timestamp).await
    }

    /// Take a user workout, process it and commit it to database.
    async fn create_or_update_user_workout(
        &self,
        gql_ctx: &Context<'_>,
        input: UserWorkoutInput,
    ) -> Result<String> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.create_or_update_user_workout(&user_id, input).await
    }

    /// Change the details about a user's workout.
    async fn update_user_workout_attributes(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateUserWorkoutAttributesInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.update_user_workout_attributes(user_id, input).await
    }

    /// Delete a workout and remove all exercise associations.
    async fn delete_user_workout(&self, gql_ctx: &Context<'_>, workout_id: String) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.delete_user_workout(user_id, workout_id).await
    }

    /// Create a custom exercise.
    async fn create_custom_exercise(
        &self,
        gql_ctx: &Context<'_>,
        input: exercise::Model,
    ) -> Result<String> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.create_custom_exercise(&user_id, input).await
    }

    /// Update a custom exercise.
    async fn update_custom_exercise(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateCustomExerciseInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.update_custom_exercise(user_id, input).await
    }

    /// Update a user's exercise settings.
    async fn update_user_exercise_settings(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateUserExerciseSettings,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<FitnessService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.update_user_exercise_settings(user_id, input).await
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
        service
            .merge_exercise(user_id, merge_from, merge_into)
            .await
    }
}
