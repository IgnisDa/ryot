use async_graphql::{Context, Object, Result};
use database_models::{exercise, user_measurement};
use database_utils::{user_workout_details, user_workout_template_details};
use dependent_entity_list_utils::{
    user_exercises_list, user_measurements_list, user_workout_templates_list, user_workouts_list,
};
use dependent_fitness_utils::{create_or_update_user_measurement, create_or_update_user_workout};
use dependent_models::{
    CachedResponse, UserExerciseDetails, UserExercisesListResponse,
    UserTemplatesOrWorkoutsListInput, UserWorkoutDetails, UserWorkoutTemplateDetails,
    UserWorkoutsListResponse, UserWorkoutsTemplatesListResponse,
};
use fitness_models::{
    UpdateUserExerciseSettings, UpdateUserWorkoutAttributesInput, UserExercisesListInput,
    UserMeasurementsListInput, UserWorkoutInput,
};
use fitness_service::{
    exercise_management, measurement_operations, template_management, workout_operations,
};
use sea_orm::prelude::DateTimeUtc;
use traits::{AuthProvider, GraphqlResolverDependency};

#[derive(Default)]
pub struct FitnessQueryResolver;

impl AuthProvider for FitnessQueryResolver {}
impl GraphqlResolverDependency for FitnessQueryResolver {}

#[Object]
impl FitnessQueryResolver {
    /// Get a paginated list of templates created by the user.
    async fn user_workout_templates_list(
        &self,
        gql_ctx: &Context<'_>,
        input: UserTemplatesOrWorkoutsListInput,
    ) -> Result<CachedResponse<UserWorkoutsTemplatesListResponse>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(user_workout_templates_list(&user_id, service, input).await?)
    }

    /// Get information about a workout template.
    async fn user_workout_template_details(
        &self,
        gql_ctx: &Context<'_>,
        workout_template_id: String,
    ) -> Result<CachedResponse<UserWorkoutTemplateDetails>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(user_workout_template_details(&user_id, workout_template_id, service).await?)
    }

    /// Get a paginated list of exercises in the database.
    async fn user_exercises_list(
        &self,
        gql_ctx: &Context<'_>,
        input: UserExercisesListInput,
    ) -> Result<CachedResponse<UserExercisesListResponse>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(user_exercises_list(&user_id, input, service).await?)
    }

    /// Get a paginated list of workouts done by the user.
    async fn user_workouts_list(
        &self,
        gql_ctx: &Context<'_>,
        input: UserTemplatesOrWorkoutsListInput,
    ) -> Result<CachedResponse<UserWorkoutsListResponse>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(user_workouts_list(&user_id, input, service).await?)
    }

    /// Get details about an exercise.
    async fn exercise_details(
        &self,
        gql_ctx: &Context<'_>,
        exercise_id: String,
    ) -> Result<exercise::Model> {
        let service = self.dependency(gql_ctx);
        Ok(exercise_management::exercise_details(service, exercise_id).await?)
    }

    /// Get details about a workout.
    async fn user_workout_details(
        &self,
        gql_ctx: &Context<'_>,
        workout_id: String,
    ) -> Result<CachedResponse<UserWorkoutDetails>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(user_workout_details(&user_id, workout_id, service).await?)
    }

    /// Get information about an exercise for a user.
    async fn user_exercise_details(
        &self,
        gql_ctx: &Context<'_>,
        exercise_id: String,
    ) -> Result<UserExerciseDetails> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(exercise_management::user_exercise_details(service, user_id, exercise_id).await?)
    }

    /// Get all the measurements for a user.
    async fn user_measurements_list(
        &self,
        gql_ctx: &Context<'_>,
        input: UserMeasurementsListInput,
    ) -> Result<CachedResponse<Vec<user_measurement::Model>>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(user_measurements_list(&user_id, service, input).await?)
    }
}

#[derive(Default)]
pub struct FitnessMutationResolver;

impl AuthProvider for FitnessMutationResolver {
    fn is_mutation(&self) -> bool {
        true
    }
}
impl GraphqlResolverDependency for FitnessMutationResolver {}

#[Object]
impl FitnessMutationResolver {
    /// Create or update a workout template.
    async fn create_or_update_user_workout_template(
        &self,
        gql_ctx: &Context<'_>,
        input: UserWorkoutInput,
    ) -> Result<String> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(
            template_management::create_or_update_user_workout_template(service, user_id, input)
                .await?,
        )
    }

    /// Delete a workout template.
    async fn delete_user_workout_template(
        &self,
        gql_ctx: &Context<'_>,
        workout_template_id: String,
    ) -> Result<bool> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(
            template_management::delete_user_workout_template(
                service,
                user_id,
                workout_template_id,
            )
            .await?,
        )
    }

    /// Create or update a user measurement.
    async fn create_or_update_user_measurement(
        &self,
        gql_ctx: &Context<'_>,
        input: user_measurement::Model,
    ) -> Result<DateTimeUtc> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(create_or_update_user_measurement(&user_id, input, service).await?)
    }

    /// Delete a user measurement.
    async fn delete_user_measurement(
        &self,
        gql_ctx: &Context<'_>,
        timestamp: DateTimeUtc,
    ) -> Result<bool> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(measurement_operations::delete_user_measurement(service, &user_id, timestamp).await?)
    }

    /// Take a user workout, process it and commit it to database.
    async fn create_or_update_user_workout(
        &self,
        gql_ctx: &Context<'_>,
        input: UserWorkoutInput,
    ) -> Result<String> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(create_or_update_user_workout(&user_id, input, service).await?)
    }

    /// Change the details about a user's workout.
    async fn update_user_workout_attributes(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateUserWorkoutAttributesInput,
    ) -> Result<bool> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(workout_operations::update_user_workout_attributes(service, user_id, input).await?)
    }

    /// Delete a workout and remove all exercise associations.
    async fn delete_user_workout(&self, gql_ctx: &Context<'_>, workout_id: String) -> Result<bool> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(workout_operations::delete_user_workout(service, user_id, workout_id).await?)
    }

    /// Update a user's exercise settings.
    async fn update_user_exercise_settings(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateUserExerciseSettings,
    ) -> Result<bool> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(exercise_management::update_user_exercise_settings(service, user_id, input).await?)
    }

    /// Merge an exercise into another.
    async fn merge_exercise(
        &self,
        gql_ctx: &Context<'_>,
        merge_from: String,
        merge_into: String,
    ) -> Result<bool> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(exercise_management::merge_exercise(service, user_id, merge_from, merge_into).await?)
    }
}
