use std::sync::Arc;

use application_utils::GraphqlRepresentation;
use async_graphql::{Error, Result};
use background::ApplicationJob;
use common_models::{
    ApplicationCacheKey, ApplicationCacheValue, SearchDetails, SearchInput, StoredUrl,
};
use common_utils::{ryot_log, PAGE_SIZE};
use database_models::{
    collection_to_entity, exercise,
    prelude::{
        CollectionToEntity, Exercise, UserMeasurement, UserToEntity, Workout, WorkoutTemplate,
    },
    user_measurement, user_to_entity, workout, workout_template,
};
use database_utils::{
    entity_in_collections, ilike_sql, item_reviews, schedule_user_for_workout_revision,
    server_key_validation_guard, user_measurements_list, user_workout_details,
    user_workout_template_details,
};
use dependent_models::{
    SearchResults, UpdateCustomExerciseInput, UserExerciseDetails, UserWorkoutDetails,
    UserWorkoutTemplateDetails,
};
use dependent_utils::{
    create_custom_exercise, create_or_update_workout, create_user_measurement,
    db_workout_to_workout_input, get_focused_workout_summary,
};
use enums::{EntityLot, ExerciseLot, ExerciseSource, Visibility};
use fitness_models::{
    ExerciseAttributes, ExerciseCategory, ExerciseListItem, ExerciseSortBy, ExercisesListInput,
    GithubExercise, GithubExerciseAttributes, ProcessedExercise, UpdateUserExerciseSettings,
    UpdateUserWorkoutAttributesInput, UserMeasurementsListInput, UserToExerciseExtraInformation,
    UserWorkoutInput, WorkoutInformation, WorkoutSetRecord, WorkoutSummary, WorkoutSummaryExercise,
};
use migrations::AliasedExercise;
use nanoid::nanoid;
use sea_orm::{
    prelude::DateTimeUtc, ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait,
    ItemsAndPagesNumber, ModelTrait, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect,
    QueryTrait, RelationTrait,
};
use sea_query::{
    extension::postgres::PgExpr, Alias, Condition, Expr, Func, JoinType, OnConflict, PgFunc,
};
use slug::slugify;
use supporting_service::SupportingService;

const EXERCISE_DB_URL: &str = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main";
const JSON_URL: &str = const_str::concat!(EXERCISE_DB_URL, "/dist/exercises.json");
const IMAGES_PREFIX_URL: &str = const_str::concat!(EXERCISE_DB_URL, "/exercises");

pub struct FitnessService(pub Arc<SupportingService>);

impl FitnessService {
    pub async fn user_workout_templates_list(
        &self,
        user_id: String,
        input: SearchInput,
    ) -> Result<SearchResults<workout_template::Model>> {
        let page = input.page.unwrap_or(1);
        let paginator = WorkoutTemplate::find()
            .filter(workout_template::Column::UserId.eq(user_id))
            .apply_if(input.query, |query, v| {
                query.filter(Expr::col(workout_template::Column::Name).ilike(ilike_sql(&v)))
            })
            .order_by_desc(workout_template::Column::CreatedOn)
            .paginate(&self.0.db, PAGE_SIZE.try_into().unwrap());
        let ItemsAndPagesNumber {
            number_of_items,
            number_of_pages,
        } = paginator.num_items_and_pages().await?;
        let items = paginator.fetch_page((page - 1).try_into().unwrap()).await?;
        Ok(SearchResults {
            details: SearchDetails {
                total: number_of_items.try_into().unwrap(),
                next_page: if page < number_of_pages.try_into().unwrap() {
                    Some(page + 1)
                } else {
                    None
                },
            },
            items,
        })
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
            assets: None,
            exercises: vec![],
            comment: input.comment,
            supersets: input.supersets,
        };
        for exercise in input.exercises {
            let db_ex = self.exercise_details(exercise.exercise_id.clone()).await?;
            summary.exercises.push(WorkoutSummaryExercise {
                name: exercise.exercise_id.clone(),
                best_set: None,
                lot: None,
                num_sets: exercise.sets.len(),
            });
            information.exercises.push(ProcessedExercise {
                total: None,
                assets: None,
                lot: db_ex.lot,
                sets: exercise
                    .sets
                    .into_iter()
                    .map(|s| WorkoutSetRecord {
                        lot: s.lot,
                        note: s.note,
                        totals: None,
                        confirmed_at: None,
                        personal_bests: None,
                        actual_rest_time: None,
                        rest_time: s.rest_time,
                        statistic: s.statistic,
                    })
                    .collect(),
                notes: exercise.notes,
                name: exercise.exercise_id,
            });
        }
        let processed_exercises = information.exercises.clone();
        summary.focused = get_focused_workout_summary(&processed_exercises, &self.0).await;
        let template = workout_template::ActiveModel {
            id: match input.update_workout_template_id {
                Some(id) => ActiveValue::Set(id),
                None => ActiveValue::Set(format!("wktpl_{}", nanoid!(12))),
            },
            name: ActiveValue::Set(input.name),
            user_id: ActiveValue::Set(user_id),
            summary: ActiveValue::Set(summary),
            information: ActiveValue::Set(information),
            visibility: ActiveValue::Set(Visibility::Private),
            ..Default::default()
        };
        let template = WorkoutTemplate::insert(template)
            .on_conflict(
                OnConflict::column(workout_template::Column::Id)
                    .update_columns([
                        workout_template::Column::Name,
                        workout_template::Column::Summary,
                        workout_template::Column::Visibility,
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
            Some(e) => Ok(e
                .graphql_representation(&self.0.file_storage_service)
                .await?),
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
            details: None,
            history: None,
            collections,
            reviews,
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
        input: SearchInput,
    ) -> Result<SearchResults<workout::Model>> {
        let page = input.page.unwrap_or(1);
        let paginator = Workout::find()
            .filter(workout::Column::UserId.eq(user_id))
            .apply_if(input.query, |query, v| {
                query.filter(Expr::col(workout::Column::Name).ilike(ilike_sql(&v)))
            })
            .order_by_desc(workout::Column::EndTime)
            .paginate(&self.0.db, PAGE_SIZE.try_into().unwrap());
        let ItemsAndPagesNumber {
            number_of_items,
            number_of_pages,
        } = paginator.num_items_and_pages().await?;
        let items = paginator.fetch_page((page - 1).try_into().unwrap()).await?;
        Ok(SearchResults {
            details: SearchDetails {
                total: number_of_items.try_into().unwrap(),
                next_page: if page < number_of_pages.try_into().unwrap() {
                    Some(page + 1)
                } else {
                    None
                },
            },
            items,
        })
    }

    pub async fn exercises_list(
        &self,
        user_id: String,
        input: ExercisesListInput,
    ) -> Result<SearchResults<ExerciseListItem>> {
        let page = input.search.page.unwrap_or(1);
        let ex = Alias::new("exercise");
        let etu = Alias::new("user_to_entity");
        let order_by_col = match input.sort_by {
            None => Expr::col((ex, exercise::Column::Id)),
            Some(sb) => match sb {
                // DEV: This is just a small hack to reduce duplicated code. We
                // are ordering by name for the other `sort_by` anyway.
                ExerciseSortBy::Name => Expr::val("1"),
                ExerciseSortBy::TimesPerformed => Expr::expr(Func::coalesce([
                    Expr::col((
                        etu.clone(),
                        user_to_entity::Column::ExerciseNumTimesInteracted,
                    ))
                    .into(),
                    Expr::val(0).into(),
                ])),
                ExerciseSortBy::LastPerformed => Expr::expr(Func::coalesce([
                    Expr::col((etu.clone(), user_to_entity::Column::LastUpdatedOn)).into(),
                    // DEV: For some reason this does not work without explicit casting on postgres
                    Func::cast_as(Expr::val("1900-01-01"), Alias::new("timestamptz")).into(),
                ])),
            },
        };
        let paginator = Exercise::find()
            .column_as(
                Expr::col((
                    etu.clone(),
                    user_to_entity::Column::ExerciseNumTimesInteracted,
                )),
                "num_times_interacted",
            )
            .column_as(
                Expr::col((etu, user_to_entity::Column::LastUpdatedOn)),
                "last_updated_on",
            )
            .filter(
                exercise::Column::Source
                    .eq(ExerciseSource::Github)
                    .or(exercise::Column::CreatedByUserId.eq(&user_id)),
            )
            .apply_if(input.filter, |query, q| {
                query
                    .apply_if(q.lot, |q, v| q.filter(exercise::Column::Lot.eq(v)))
                    .apply_if(q.muscle, |q, v| {
                        q.filter(Expr::val(v).eq(PgFunc::any(Expr::col(exercise::Column::Muscles))))
                    })
                    .apply_if(q.level, |q, v| q.filter(exercise::Column::Level.eq(v)))
                    .apply_if(q.force, |q, v| q.filter(exercise::Column::Force.eq(v)))
                    .apply_if(q.mechanic, |q, v| {
                        q.filter(exercise::Column::Mechanic.eq(v))
                    })
                    .apply_if(q.equipment, |q, v| {
                        q.filter(exercise::Column::Equipment.eq(v))
                    })
                    .apply_if(q.collection, |q, v| {
                        q.left_join(CollectionToEntity)
                            .filter(collection_to_entity::Column::CollectionId.eq(v))
                    })
            })
            .apply_if(input.search.query, |query, v| {
                query.filter(
                    Condition::any()
                        .add(
                            Expr::col((AliasedExercise::Table, AliasedExercise::Id))
                                .ilike(ilike_sql(&v)),
                        )
                        .add(Expr::col(exercise::Column::Name).ilike(slugify(v))),
                )
            })
            .join(
                JoinType::LeftJoin,
                user_to_entity::Relation::Exercise
                    .def()
                    .rev()
                    .on_condition(move |_left, right| {
                        Condition::all()
                            .add(Expr::col((right, user_to_entity::Column::UserId)).eq(&user_id))
                    }),
            )
            .order_by_desc(order_by_col)
            .order_by_asc(exercise::Column::Id)
            .into_model::<ExerciseListItem>()
            .paginate(&self.0.db, PAGE_SIZE.try_into().unwrap());
        let ItemsAndPagesNumber {
            number_of_items,
            number_of_pages,
        } = paginator.num_items_and_pages().await?;
        let mut items = vec![];
        for ex in paginator.fetch_page((page - 1).try_into().unwrap()).await? {
            let mut converted_exercise = ex.clone();
            if let Some(img) = ex.attributes.internal_images.first() {
                converted_exercise.image = Some(
                    self.0
                        .file_storage_service
                        .get_stored_asset(img.clone())
                        .await,
                )
            }
            converted_exercise.muscle = ex.muscles.first().cloned();
            items.push(converted_exercise);
        }
        Ok(SearchResults {
            details: SearchDetails {
                total: number_of_items.try_into().unwrap(),
                next_page: if page < number_of_pages.try_into().unwrap() {
                    Some(page + 1)
                } else {
                    None
                },
            },
            items,
        })
    }

    pub async fn deploy_update_exercise_library_job(&self) -> Result<bool> {
        if Exercise::find().count(&self.0.db).await? > 0 {
            return Ok(true);
        }
        ryot_log!(
            info,
            "Instance does not have exercises data. Deploying job to download them..."
        );
        let exercises = self.get_all_exercises_from_dataset().await?;
        for exercise in exercises {
            self.0
                .perform_application_job(ApplicationJob::UpdateGithubExerciseJob(exercise))
                .await?;
        }
        Ok(true)
    }

    pub async fn update_github_exercise(&self, ex: GithubExercise) -> Result<()> {
        let attributes = ExerciseAttributes {
            instructions: ex.attributes.instructions,
            internal_images: ex
                .attributes
                .images
                .into_iter()
                .map(StoredUrl::Url)
                .collect(),
            images: vec![],
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
        create_user_measurement(user_id, input, &self.0.db).await
    }

    pub async fn delete_user_measurement(
        &self,
        user_id: String,
        timestamp: DateTimeUtc,
    ) -> Result<bool> {
        let Some(m) = UserMeasurement::find_by_id((timestamp, user_id))
            .one(&self.0.db)
            .await?
        else {
            return Ok(false);
        };
        m.delete(&self.0.db).await?;
        Ok(true)
    }

    pub async fn create_or_update_user_workout(
        &self,
        user_id: &String,
        input: UserWorkoutInput,
    ) -> Result<String> {
        let identifier = create_or_update_workout(input, user_id, &self.0).await?;
        Ok(identifier)
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
                .filter(user_to_entity::Column::ExerciseId.eq(ex.name.clone()))
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
        UserToEntity::delete_many()
            .filter(user_to_entity::Column::UserId.eq(&user_id))
            .filter(user_to_entity::Column::ExerciseId.is_not_null())
            .exec(&self.0.db)
            .await?;
        let workouts = Workout::find()
            .filter(workout::Column::UserId.eq(&user_id))
            .order_by_asc(workout::Column::EndTime)
            .all(&self.0.db)
            .await?;
        let total = workouts.len();
        for (idx, workout) in workouts.into_iter().enumerate() {
            workout.clone().delete(&self.0.db).await?;
            let workout_input = db_workout_to_workout_input(workout);
            self.create_or_update_user_workout(&user_id, workout_input)
                .await?;
            ryot_log!(debug, "Revised workout: {}/{}", idx + 1, total);
        }
        Ok(())
    }

    async fn change_exercise_name_in_history(
        &self,
        new_name: String,
        old_entity: user_to_entity::Model,
    ) -> Result<()> {
        for workout in old_entity.exercise_extra_information.unwrap().history {
            let db_workout = Workout::find_by_id(workout.workout_id)
                .one(&self.0.db)
                .await?
                .unwrap();
            let mut summary = db_workout.summary.clone();
            let mut information = db_workout.information.clone();
            summary.exercises[workout.idx].name = new_name.clone();
            information.exercises[workout.idx].name = new_name.clone();
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
        let entity = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(&user_id))
            .filter(user_to_entity::Column::ExerciseId.eq(input.old_id.clone()))
            .one(&self.0.db)
            .await?
            .ok_or_else(|| Error::new("Exercise does not exist"))?;
        let old_exercise = Exercise::find_by_id(input.old_id.clone())
            .one(&self.0.db)
            .await?
            .unwrap();
        if input.should_delete.unwrap_or_default() {
            if !entity
                .exercise_extra_information
                .unwrap_or_default()
                .history
                .is_empty()
            {
                return Err(Error::new(
                    "Exercise is associated with one or more workouts.",
                ));
            }
            old_exercise.delete(&self.0.db).await?;
            return Ok(true);
        }
        if input.old_id != input.update.id {
            if Exercise::find_by_id(input.update.id.clone())
                .one(&self.0.db)
                .await?
                .is_some()
            {
                return Err(Error::new("Exercise with the new name already exists."));
            }
            Exercise::update_many()
                .col_expr(exercise::Column::Name, Expr::value(input.update.id.clone()))
                .filter(exercise::Column::Id.eq(input.old_id.clone()))
                .exec(&self.0.db)
                .await?;
        }
        for image in old_exercise.attributes.internal_images {
            if let StoredUrl::S3(key) = image {
                self.0.file_storage_service.delete_object(key).await;
            }
        }
        self.create_custom_exercise(&user_id, input.update.clone())
            .await?;
        schedule_user_for_workout_revision(&user_id, &self.0).await?;
        Ok(true)
    }

    pub async fn update_user_exercise_settings(
        &self,
        user_id: String,
        input: UpdateUserExerciseSettings,
    ) -> Result<bool> {
        let err = || Error::new("Incorrect property value encountered");
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
        if input.change.property.contains('.') {
            let (left, right) = input.change.property.split_once('.').ok_or_else(err)?;
            match left {
                "set_rest_timers" => {
                    let value = input.change.value.parse().unwrap();
                    let set_rest_timers = &mut exercise_extra_information.settings.set_rest_timers;
                    match right {
                        "drop" => set_rest_timers.drop = Some(value),
                        "normal" => set_rest_timers.normal = Some(value),
                        "warmup" => set_rest_timers.warmup = Some(value),
                        "failure" => set_rest_timers.failure = Some(value),
                        _ => return Err(err()),
                    }
                }
                _ => return Err(err()),
            };
        } else {
            match input.change.property.as_str() {
                "exclude_from_analytics" => {
                    exercise_extra_information.settings.exclude_from_analytics =
                        input.change.value.parse().unwrap();
                }
                _ => return Err(err()),
            }
        }
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
        self.change_exercise_name_in_history(merge_into, old_entity)
            .await?;
        schedule_user_for_workout_revision(&user_id, &self.0).await?;
        Ok(true)
    }

    pub async fn process_users_scheduled_for_workout_revision(&self) -> Result<()> {
        let cs = &self.0.cache_service;
        let Some(ApplicationCacheValue::UsersScheduledForWorkoutRevision(revisions)) = cs
            .get_key(ApplicationCacheKey::UsersScheduledForWorkoutRevision)
            .await?
        else {
            return Ok(());
        };
        for user_id in revisions {
            ryot_log!(debug, "Revising workouts for {}", user_id);
            self.revise_user_workouts(user_id).await?;
        }
        ryot_log!(debug, "Completed scheduled workout revisions");
        cs.expire_key(ApplicationCacheKey::UsersScheduledForWorkoutRevision)
            .await?;
        Ok(())
    }
}
