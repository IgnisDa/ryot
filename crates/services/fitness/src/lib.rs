use std::sync::Arc;

use async_graphql::{Error, Result};
use background_models::{ApplicationJob, MpApplicationJob};
use common_models::EntityAssets;
use common_utils::ryot_log;
use database_models::{
    exercise,
    prelude::{Exercise, UserMeasurement, UserToEntity, Workout, WorkoutTemplate},
    user, user_measurement, user_to_entity, workout, workout_template,
};
use database_utils::{
    entity_in_collections, get_user_query, item_reviews, schedule_user_for_workout_revision,
    server_key_validation_guard, transform_entity_assets, user_measurements_list,
    user_workout_details, user_workout_template_details,
};
use dependent_models::{
    CachedResponse, UpdateCustomExerciseInput, UserExerciseDetails, UserExercisesListResponse,
    UserTemplatesOrWorkoutsListInput, UserWorkoutDetails, UserWorkoutTemplateDetails,
    UserWorkoutsListResponse, UserWorkoutsTemplatesListResponse,
};
use dependent_utils::{
    create_custom_exercise, create_or_update_user_workout, create_user_measurement,
    db_workout_to_workout_input, get_focused_workout_summary, user_exercises_list,
    user_workout_templates_list, user_workouts_list,
};
use enum_models::{EntityLot, ExerciseLot, ExerciseSource};
use fitness_models::{
    ExerciseAttributes, ExerciseCategory, GithubExercise, GithubExerciseAttributes,
    ProcessedExercise, UpdateUserExerciseSettings, UpdateUserWorkoutAttributesInput,
    UserExercisesListInput, UserMeasurementsListInput, UserToExerciseExtraInformation,
    UserWorkoutInput, WorkoutInformation, WorkoutSetRecord, WorkoutSummary, WorkoutSummaryExercise,
};
use futures::TryStreamExt;
use nanoid::nanoid;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, ModelTrait, PaginatorTrait,
    QueryFilter, QueryOrder, prelude::DateTimeUtc,
};
use sea_query::{Expr, OnConflict};
use supporting_service::SupportingService;

const EXERCISE_DB_URL: &str = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main";
const JSON_URL: &str = const_str::concat!(EXERCISE_DB_URL, "/dist/exercises.json");
const IMAGES_PREFIX_URL: &str = const_str::concat!(EXERCISE_DB_URL, "/exercises");

pub struct FitnessService(pub Arc<SupportingService>);

impl FitnessService {
    pub async fn user_workout_templates_list(
        &self,
        user_id: String,
        input: UserTemplatesOrWorkoutsListInput,
    ) -> Result<CachedResponse<UserWorkoutsTemplatesListResponse>> {
        user_workout_templates_list(&user_id, &self.0, input).await
    }

    pub async fn user_workout_template_details(
        &self,
        user_id: String,
        workout_template_id: String,
    ) -> Result<UserWorkoutTemplateDetails> {
        user_workout_template_details(&self.0.db, &user_id, workout_template_id).await
    }

    pub async fn create_or_update_user_workout_template(
        &self,
        user_id: String,
        input: UserWorkoutInput,
    ) -> Result<String> {
        server_key_validation_guard(self.0.is_server_key_validated().await?).await?;
        let mut summary = WorkoutSummary::default();
        let mut information = WorkoutInformation {
            comment: input.comment,
            supersets: input.supersets,
            ..Default::default()
        };
        for exercise in input.exercises {
            let db_ex = self.exercise_details(exercise.exercise_id.clone()).await?;
            summary.exercises.push(WorkoutSummaryExercise {
                num_sets: exercise.sets.len(),
                id: exercise.exercise_id.clone(),
                ..Default::default()
            });
            information.exercises.push(ProcessedExercise {
                lot: db_ex.lot,
                notes: exercise.notes,
                id: exercise.exercise_id,
                sets: exercise
                    .sets
                    .into_iter()
                    .map(|s| WorkoutSetRecord {
                        lot: s.lot,
                        rpe: s.rpe,
                        note: s.note,
                        rest_time: s.rest_time,
                        statistic: s.statistic,
                        rest_timer_started_at: s.rest_timer_started_at,
                        ..Default::default()
                    })
                    .collect(),
                ..Default::default()
            });
        }
        let processed_exercises = information.exercises.clone();
        summary.focused = get_focused_workout_summary(&processed_exercises, &self.0).await;
        let template = workout_template::ActiveModel {
            name: ActiveValue::Set(input.name),
            user_id: ActiveValue::Set(user_id),
            summary: ActiveValue::Set(summary),
            information: ActiveValue::Set(information),
            id: match input.update_workout_template_id {
                Some(id) => ActiveValue::Set(id),
                None => ActiveValue::Set(format!("wktpl_{}", nanoid!(12))),
            },
            ..Default::default()
        };
        let template = WorkoutTemplate::insert(template)
            .on_conflict(
                OnConflict::column(workout_template::Column::Id)
                    .update_columns([
                        workout_template::Column::Name,
                        workout_template::Column::Summary,
                        workout_template::Column::Information,
                    ])
                    .to_owned(),
            )
            .exec_with_returning(&self.0.db)
            .await?;
        Ok(template.id)
    }

    pub async fn delete_user_workout_template(
        &self,
        user_id: String,
        workout_template_id: String,
    ) -> Result<bool> {
        server_key_validation_guard(self.0.is_server_key_validated().await?).await?;
        let Some(wkt) = WorkoutTemplate::find_by_id(workout_template_id)
            .filter(workout_template::Column::UserId.eq(&user_id))
            .one(&self.0.db)
            .await?
        else {
            return Err(Error::new("Workout template does not exist for user"));
        };
        wkt.delete(&self.0.db).await?;
        Ok(true)
    }

    async fn get_all_exercises_from_dataset(&self) -> Result<Vec<GithubExercise>> {
        let data = reqwest::get(JSON_URL)
            .await
            .unwrap()
            .json::<Vec<GithubExercise>>()
            .await
            .unwrap();
        Ok(data
            .into_iter()
            .map(|e| GithubExercise {
                attributes: GithubExerciseAttributes {
                    images: e
                        .attributes
                        .images
                        .into_iter()
                        .map(|i| format!("{}/{}", IMAGES_PREFIX_URL, i))
                        .collect(),
                    ..e.attributes
                },
                ..e
            })
            .collect())
    }

    pub async fn exercise_details(&self, exercise_id: String) -> Result<exercise::Model> {
        let maybe_exercise = Exercise::find_by_id(exercise_id).one(&self.0.db).await?;
        match maybe_exercise {
            None => Err(Error::new("Exercise with the given ID could not be found.")),
            Some(mut e) => {
                transform_entity_assets(&mut e.attributes.assets, &self.0).await;
                Ok(e)
            }
        }
    }

    pub async fn user_workout_details(
        &self,
        user_id: &String,
        workout_id: String,
    ) -> Result<UserWorkoutDetails> {
        user_workout_details(user_id, workout_id, &self.0).await
    }

    pub async fn user_exercise_details(
        &self,
        user_id: String,
        exercise_id: String,
    ) -> Result<UserExerciseDetails> {
        let collections =
            entity_in_collections(&self.0.db, &user_id, &exercise_id, EntityLot::Exercise).await?;
        let reviews =
            item_reviews(&user_id, &exercise_id, EntityLot::Exercise, true, &self.0).await?;
        let mut resp = UserExerciseDetails {
            collections,
            reviews,
            ..Default::default()
        };
        if let Some(association) = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .filter(user_to_entity::Column::ExerciseId.eq(exercise_id))
            .one(&self.0.db)
            .await?
        {
            let user_to_exercise_extra_information = association
                .exercise_extra_information
                .clone()
                .unwrap_or_default();
            resp.history = Some(user_to_exercise_extra_information.history);
            resp.details = Some(association);
        }
        Ok(resp)
    }

    pub async fn user_workouts_list(
        &self,
        user_id: String,
        input: UserTemplatesOrWorkoutsListInput,
    ) -> Result<CachedResponse<UserWorkoutsListResponse>> {
        user_workouts_list(&user_id, input, &self.0).await
    }

    pub async fn user_exercises_list(
        &self,
        user_id: String,
        input: UserExercisesListInput,
    ) -> Result<CachedResponse<UserExercisesListResponse>> {
        user_exercises_list(&user_id, input, &self.0).await
    }

    pub async fn deploy_update_exercise_library_job(&self) -> Result<()> {
        if Exercise::find().count(&self.0.db).await? > 0 {
            return Ok(());
        }
        ryot_log!(
            info,
            "Instance does not have exercises data. Deploying job to download them..."
        );
        self.0
            .perform_application_job(ApplicationJob::Mp(MpApplicationJob::UpdateGithubExercises))
            .await?;
        Ok(())
    }

    pub async fn update_github_exercises(&self) -> Result<()> {
        let exercises = self.get_all_exercises_from_dataset().await?;
        for exercise in exercises {
            self.update_github_exercise(exercise).await?;
        }
        Ok(())
    }

    async fn update_github_exercise(&self, ex: GithubExercise) -> Result<()> {
        let attributes = ExerciseAttributes {
            instructions: ex.attributes.instructions,
            assets: EntityAssets {
                remote_images: ex.attributes.images,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut muscles = ex.attributes.primary_muscles;
        muscles.extend(ex.attributes.secondary_muscles);
        if let Some(e) = Exercise::find()
            .filter(exercise::Column::Id.eq(&ex.name))
            .filter(exercise::Column::Source.eq(ExerciseSource::Github))
            .one(&self.0.db)
            .await?
        {
            ryot_log!(
                debug,
                "Updating existing exercise with identifier: {}",
                ex.name
            );
            let mut db_ex: exercise::ActiveModel = e.into();
            db_ex.attributes = ActiveValue::Set(attributes);
            db_ex.muscles = ActiveValue::Set(muscles);
            db_ex.update(&self.0.db).await?;
        } else {
            let lot = match ex.attributes.category {
                ExerciseCategory::Cardio => ExerciseLot::DistanceAndDuration,
                ExerciseCategory::Stretching | ExerciseCategory::Plyometrics => {
                    ExerciseLot::Duration
                }
                ExerciseCategory::Strongman
                | ExerciseCategory::OlympicWeightlifting
                | ExerciseCategory::Strength
                | ExerciseCategory::Powerlifting => ExerciseLot::RepsAndWeight,
            };
            let db_exercise = exercise::ActiveModel {
                lot: ActiveValue::Set(lot),
                muscles: ActiveValue::Set(muscles),
                id: ActiveValue::Set(ex.name.clone()),
                name: ActiveValue::Set(ex.name.clone()),
                attributes: ActiveValue::Set(attributes),
                created_by_user_id: ActiveValue::Set(None),
                level: ActiveValue::Set(ex.attributes.level),
                force: ActiveValue::Set(ex.attributes.force),
                source: ActiveValue::Set(ExerciseSource::Github),
                equipment: ActiveValue::Set(ex.attributes.equipment),
                mechanic: ActiveValue::Set(ex.attributes.mechanic),
            };
            let created_exercise = db_exercise.insert(&self.0.db).await?;
            ryot_log!(
                debug,
                "Created new exercise with id: {}",
                created_exercise.id
            );
        }
        Ok(())
    }

    pub async fn user_measurements_list(
        &self,
        user_id: &String,
        input: UserMeasurementsListInput,
    ) -> Result<Vec<user_measurement::Model>> {
        user_measurements_list(&self.0.db, user_id, input).await
    }

    pub async fn create_user_measurement(
        &self,
        user_id: &String,
        input: user_measurement::Model,
    ) -> Result<DateTimeUtc> {
        create_user_measurement(user_id, input, &self.0).await
    }

    pub async fn delete_user_measurement(
        &self,
        user_id: String,
        timestamp: DateTimeUtc,
    ) -> Result<bool> {
        let m = UserMeasurement::find_by_id((timestamp, user_id))
            .one(&self.0.db)
            .await?
            .ok_or_else(|| Error::new("Measurement does not exist"))?;
        m.delete(&self.0.db).await?;
        Ok(true)
    }

    pub async fn create_or_update_user_workout(
        &self,
        user_id: &String,
        input: UserWorkoutInput,
    ) -> Result<String> {
        create_or_update_user_workout(user_id, input, &self.0).await
    }

    pub async fn update_user_workout_attributes(
        &self,
        user_id: String,
        input: UpdateUserWorkoutAttributesInput,
    ) -> Result<bool> {
        let Some(wkt) = Workout::find()
            .filter(workout::Column::UserId.eq(&user_id))
            .filter(workout::Column::Id.eq(input.id))
            .one(&self.0.db)
            .await?
        else {
            return Err(Error::new("Workout does not exist for user"));
        };
        let mut new_wkt: workout::ActiveModel = wkt.into();
        if let Some(d) = input.start_time {
            new_wkt.start_time = ActiveValue::Set(d);
        }
        if let Some(d) = input.end_time {
            new_wkt.end_time = ActiveValue::Set(d);
        }
        if new_wkt.is_changed() {
            new_wkt.update(&self.0.db).await?;
            schedule_user_for_workout_revision(&user_id, &self.0).await?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub async fn create_custom_exercise(
        &self,
        user_id: &String,
        input: exercise::Model,
    ) -> Result<String> {
        create_custom_exercise(user_id, input, &self.0).await
    }

    pub async fn delete_user_workout(&self, user_id: String, workout_id: String) -> Result<bool> {
        let Some(wkt) = Workout::find_by_id(workout_id)
            .filter(workout::Column::UserId.eq(&user_id))
            .one(&self.0.db)
            .await?
        else {
            return Err(Error::new("Workout does not exist for user"));
        };
        for (idx, ex) in wkt.information.exercises.iter().enumerate() {
            let Some(association) = UserToEntity::find()
                .filter(user_to_entity::Column::UserId.eq(&user_id))
                .filter(user_to_entity::Column::ExerciseId.eq(ex.id.clone()))
                .one(&self.0.db)
                .await?
            else {
                continue;
            };
            let mut ei = association
                .exercise_extra_information
                .clone()
                .unwrap_or_default();
            if let Some(ex_idx) = ei
                .history
                .iter()
                .position(|e| e.workout_id == wkt.id && e.idx == idx)
            {
                ei.history.remove(ex_idx);
            }
            let mut association: user_to_entity::ActiveModel = association.into();
            association.exercise_extra_information = ActiveValue::Set(Some(ei));
            association.update(&self.0.db).await?;
        }
        wkt.delete(&self.0.db).await?;
        schedule_user_for_workout_revision(&user_id, &self.0).await?;
        Ok(true)
    }

    pub async fn revise_user_workouts(&self, user_id: String) -> Result<()> {
        let mut all_stream = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(&user_id))
            .filter(user_to_entity::Column::ExerciseId.is_not_null())
            .stream(&self.0.db)
            .await?;
        while let Some(ute) = all_stream.try_next().await? {
            let mut new = UserToExerciseExtraInformation::default();
            let eei = ute.exercise_extra_information.clone().unwrap_or_default();
            new.settings = eei.settings;
            let mut ute: user_to_entity::ActiveModel = ute.into();
            ute.exercise_num_times_interacted = ActiveValue::Set(None);
            ute.exercise_extra_information = ActiveValue::Set(Some(new));
            ute.update(&self.0.db).await?;
        }
        let workouts = Workout::find()
            .filter(workout::Column::UserId.eq(&user_id))
            .order_by_asc(workout::Column::EndTime)
            .all(&self.0.db)
            .await?;
        let total = workouts.len();
        for (idx, workout) in workouts.into_iter().enumerate() {
            workout.clone().delete(&self.0.db).await?;
            let workout_input = db_workout_to_workout_input(workout);
            create_or_update_user_workout(&user_id, workout_input, &self.0).await?;
            ryot_log!(debug, "Revised workout: {}/{}", idx + 1, total);
        }
        Ok(())
    }

    async fn change_exercise_id_in_history(
        &self,
        new_name: String,
        old_entity: user_to_entity::Model,
    ) -> Result<()> {
        let Some(exercise_extra_information) = old_entity.exercise_extra_information else {
            return Ok(());
        };
        for workout in exercise_extra_information.history {
            let db_workout = Workout::find_by_id(workout.workout_id)
                .one(&self.0.db)
                .await?
                .unwrap();
            let mut summary = db_workout.summary.clone();
            let mut information = db_workout.information.clone();
            summary.exercises[workout.idx].id = new_name.clone();
            information.exercises[workout.idx].id = new_name.clone();
            let mut db_workout: workout::ActiveModel = db_workout.into();
            db_workout.summary = ActiveValue::Set(summary);
            db_workout.information = ActiveValue::Set(information);
            db_workout.update(&self.0.db).await?;
        }
        Ok(())
    }

    pub async fn update_custom_exercise(
        &self,
        user_id: String,
        input: UpdateCustomExerciseInput,
    ) -> Result<bool> {
        let id = input.update.id.clone();
        let mut update = input.update.clone();
        let old_exercise = Exercise::find_by_id(&id).one(&self.0.db).await?.unwrap();
        for image in old_exercise.attributes.assets.s3_images.clone() {
            self.0.file_storage_service.delete_object(image).await;
        }
        if input.should_delete.unwrap_or_default() {
            let ute = UserToEntity::find()
                .filter(user_to_entity::Column::UserId.eq(&user_id))
                .filter(user_to_entity::Column::ExerciseId.eq(&id))
                .one(&self.0.db)
                .await?
                .ok_or_else(|| Error::new("Exercise does not exist"))?;
            if let Some(exercise_extra_information) = ute.exercise_extra_information {
                if !exercise_extra_information.history.is_empty() {
                    return Err(Error::new(
                        "Exercise is associated with one or more workouts.",
                    ));
                }
            }
            old_exercise.delete(&self.0.db).await?;
            return Ok(true);
        }
        update.source = ExerciseSource::Custom;
        update.created_by_user_id = Some(user_id.clone());
        let input: exercise::ActiveModel = update.into();
        let mut input = input.reset_all();
        input.id = ActiveValue::Unchanged(id);
        input.update(&self.0.db).await?;
        Ok(true)
    }

    pub async fn update_user_exercise_settings(
        &self,
        user_id: String,
        input: UpdateUserExerciseSettings,
    ) -> Result<bool> {
        let ute = match UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(&user_id))
            .filter(user_to_entity::Column::ExerciseId.eq(&input.exercise_id))
            .one(&self.0.db)
            .await?
        {
            Some(ute) => ute,
            None => {
                let data = user_to_entity::ActiveModel {
                    user_id: ActiveValue::Set(user_id),
                    exercise_id: ActiveValue::Set(Some(input.exercise_id)),
                    exercise_extra_information: ActiveValue::Set(Some(
                        UserToExerciseExtraInformation::default(),
                    )),
                    ..Default::default()
                };
                data.insert(&self.0.db).await?
            }
        };
        let mut exercise_extra_information = ute.clone().exercise_extra_information.unwrap();
        exercise_extra_information.settings = input.change;
        let mut ute: user_to_entity::ActiveModel = ute.into();
        ute.exercise_extra_information = ActiveValue::Set(Some(exercise_extra_information));
        ute.update(&self.0.db).await?;
        Ok(true)
    }

    pub async fn merge_exercise(
        &self,
        user_id: String,
        merge_from: String,
        merge_into: String,
    ) -> Result<bool> {
        let old_exercise = Exercise::find_by_id(merge_from.clone())
            .one(&self.0.db)
            .await?
            .ok_or_else(|| Error::new("Exercise does not exist"))?;
        let new_exercise = Exercise::find_by_id(merge_into.clone())
            .one(&self.0.db)
            .await?
            .ok_or_else(|| Error::new("Exercise does not exist"))?;
        if old_exercise.id == new_exercise.id {
            return Err(Error::new("Cannot merge exercise with itself"));
        }
        if old_exercise.lot != new_exercise.lot {
            return Err(Error::new(format!(
                "Exercises must be of the same lot, got from={:#?} and into={:#?}",
                old_exercise.lot, new_exercise.lot
            )));
        }
        let old_entity = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(&user_id))
            .filter(user_to_entity::Column::ExerciseId.eq(merge_from.clone()))
            .one(&self.0.db)
            .await?
            .ok_or_else(|| Error::new("Exercise does not exist"))?;
        self.change_exercise_id_in_history(merge_into, old_entity)
            .await?;
        schedule_user_for_workout_revision(&user_id, &self.0).await?;
        Ok(true)
    }

    pub async fn process_users_scheduled_for_workout_revision(&self) -> Result<()> {
        let revisions = get_user_query()
            .filter(Expr::cust(
                "(extra_information -> 'scheduled_for_workout_revision')::boolean = true",
            ))
            .all(&self.0.db)
            .await?;
        if revisions.is_empty() {
            return Ok(());
        }
        for user in revisions {
            ryot_log!(debug, "Revising workouts for {}", user.id);
            self.revise_user_workouts(user.id.clone()).await?;
            let mut extra_information = user.extra_information.clone().unwrap_or_default();
            extra_information.scheduled_for_workout_revision = false;
            let mut user: user::ActiveModel = user.into();
            user.extra_information = ActiveValue::Set(Some(extra_information));
            user.update(&self.0.db).await?;
        }
        ryot_log!(debug, "Completed scheduled workout revisions");
        Ok(())
    }
}
