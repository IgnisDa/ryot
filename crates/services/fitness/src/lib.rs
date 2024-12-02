use std::sync::Arc;

use application_utils::GraphqlRepresentation;
use async_graphql::{Error, Result};
use background::ApplicationJob;
use common_models::{
    ChangeCollectionToEntityInput, DefaultCollection, SearchDetails, SearchInput, StoredUrl,
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
    add_entity_to_collection, deploy_job_to_re_evaluate_user_workouts, entity_in_collections,
    ilike_sql, item_reviews, pro_instance_guard, user_measurements_list, user_workout_details,
    user_workout_template_details,
};
use dependent_models::{
    SearchResults, UpdateCustomExerciseInput, UserExerciseDetails, UserWorkoutDetails,
    UserWorkoutTemplateDetails,
};
use dependent_utils::{
    create_or_update_workout, create_user_measurement, db_workout_to_workout_input,
    get_focused_workout_summary,
};
use enums::{
    EntityLot, ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMechanic,
    ExerciseMuscle, ExerciseSource, Visibility,
};
use fitness_models::{
    ExerciseAttributes, ExerciseCategory, ExerciseFilters, ExerciseListItem, ExerciseParameters,
    ExerciseParametersLotMapping, ExerciseSortBy, ExercisesListInput, GithubExercise,
    GithubExerciseAttributes, ProcessedExercise, UpdateUserExerciseSettings,
    UpdateUserWorkoutAttributesInput, UserMeasurementsListInput, UserToExerciseExtraInformation,
    UserWorkoutInput, WorkoutInformation, WorkoutSetRecord, WorkoutSummary, WorkoutSummaryExercise,
    LOT_MAPPINGS,
};
use itertools::Itertools;
use migrations::AliasedExercise;
use nanoid::nanoid;
use sea_orm::{
    prelude::DateTimeUtc, ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, Iterable,
    ModelTrait, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait, RelationTrait,
};
use sea_query::{
    extension::postgres::PgExpr, Alias, Condition, Expr, Func, JoinType, OnConflict, PgFunc,
};
use slug::slugify;
use supporting_service::SupportingService;

const EXERCISE_DB_URL: &str = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main";
const JSON_URL: &str = const_str::concat!(EXERCISE_DB_URL, "/dist/exercises.json");
const IMAGES_PREFIX_URL: &str = const_str::concat!(EXERCISE_DB_URL, "/exercises");

pub struct ExerciseService(pub Arc<SupportingService>);

impl ExerciseService {
    pub async fn user_workout_templates_list(
        &self,
        user_id: String,
        input: SearchInput,
    ) -> Result<SearchResults<workout_template::Model>> {
        let page = input.page.unwrap_or(1);
        let query = WorkoutTemplate::find()
            .filter(workout_template::Column::UserId.eq(user_id))
            .apply_if(input.query, |query, v| {
                query.filter(Expr::col(workout_template::Column::Name).ilike(ilike_sql(&v)))
            })
            .order_by_desc(workout_template::Column::CreatedOn);
        let total = query.clone().count(&self.0.db).await?;
        let total: i32 = total.try_into().unwrap();
        let data = query.paginate(&self.0.db, PAGE_SIZE.try_into().unwrap());
        let items = data.fetch_page((page - 1).try_into().unwrap()).await?;
        let next_page = if total - (page * PAGE_SIZE) > 0 {
            Some(page + 1)
        } else {
            None
        };
        Ok(SearchResults {
            details: SearchDetails { total, next_page },
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
        pro_instance_guard(self.0.is_pro).await?;
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
        pro_instance_guard(self.0.is_pro).await?;
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

    pub async fn exercise_parameters(&self) -> Result<ExerciseParameters> {
        let download_required = Exercise::find().count(&self.0.db).await? == 0;
        Ok(ExerciseParameters {
            filters: ExerciseFilters {
                lot: ExerciseLot::iter().collect_vec(),
                level: ExerciseLevel::iter().collect_vec(),
                force: ExerciseForce::iter().collect_vec(),
                mechanic: ExerciseMechanic::iter().collect_vec(),
                equipment: ExerciseEquipment::iter().collect_vec(),
                muscle: ExerciseMuscle::iter().collect_vec(),
            },
            download_required,
            lot_mapping: LOT_MAPPINGS
                .iter()
                .map(|(lot, pbs)| ExerciseParametersLotMapping {
                    lot: *lot,
                    bests: pbs.to_vec(),
                })
                .collect(),
        })
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
        let query = Workout::find()
            .filter(workout::Column::UserId.eq(user_id))
            .apply_if(input.query, |query, v| {
                query.filter(Expr::col(workout::Column::Name).ilike(ilike_sql(&v)))
            })
            .order_by_desc(workout::Column::EndTime);
        let total = query.clone().count(&self.0.db).await?;
        let total: i32 = total.try_into().unwrap();
        let data = query.paginate(&self.0.db, PAGE_SIZE.try_into().unwrap());
        let items = data.fetch_page((page - 1).try_into().unwrap()).await?;
        let next_page = if total - (page * PAGE_SIZE) > 0 {
            Some(page + 1)
        } else {
            None
        };
        Ok(SearchResults {
            details: SearchDetails { total, next_page },
            items,
        })
    }

    pub async fn exercises_list(
        &self,
        user_id: String,
        input: ExercisesListInput,
    ) -> Result<SearchResults<ExerciseListItem>> {
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
        let query = Exercise::find()
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
                        .add(Expr::col(exercise::Column::Identifier).ilike(slugify(v))),
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
            .order_by_asc(exercise::Column::Id);
        let total = query.clone().count(&self.0.db).await?;
        let total: i32 = total.try_into().unwrap();
        let data = query
            .into_model::<ExerciseListItem>()
            .paginate(&self.0.db, PAGE_SIZE.try_into().unwrap());
        let mut items = vec![];
        for ex in data
            .fetch_page((input.search.page.unwrap() - 1).try_into().unwrap())
            .await?
        {
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
        let next_page = if total - ((input.search.page.unwrap()) * PAGE_SIZE) > 0 {
            Some(input.search.page.unwrap() + 1)
        } else {
            None
        };
        Ok(SearchResults {
            details: SearchDetails { total, next_page },
            items,
        })
    }

    pub async fn deploy_update_exercise_library_job(&self) -> Result<bool> {
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
            .filter(exercise::Column::Identifier.eq(&ex.identifier))
            .filter(exercise::Column::Source.eq(ExerciseSource::Github))
            .one(&self.0.db)
            .await?
        {
            ryot_log!(
                debug,
                "Updating existing exercise with identifier: {}",
                ex.identifier
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
                id: ActiveValue::Set(ex.name),
                source: ActiveValue::Set(ExerciseSource::Github),
                identifier: ActiveValue::Set(Some(ex.identifier)),
                muscles: ActiveValue::Set(muscles),
                attributes: ActiveValue::Set(attributes),
                lot: ActiveValue::Set(lot),
                level: ActiveValue::Set(ex.attributes.level),
                force: ActiveValue::Set(ex.attributes.force),
                equipment: ActiveValue::Set(ex.attributes.equipment),
                mechanic: ActiveValue::Set(ex.attributes.mechanic),
                created_by_user_id: ActiveValue::Set(None),
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
            deploy_job_to_re_evaluate_user_workouts(&user_id, &self.0).await;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub async fn create_custom_exercise(
        &self,
        user_id: String,
        input: exercise::Model,
    ) -> Result<String> {
        let exercise_id = input.id.clone();
        let mut input = input;
        input.created_by_user_id = Some(user_id.clone());
        input.source = ExerciseSource::Custom;
        input.attributes.internal_images = input
            .attributes
            .images
            .clone()
            .into_iter()
            .map(StoredUrl::S3)
            .collect();
        input.attributes.images = vec![];
        let input: exercise::ActiveModel = input.into();
        let exercise = match Exercise::find_by_id(exercise_id)
            .filter(exercise::Column::Source.eq(ExerciseSource::Custom))
            .one(&self.0.db)
            .await?
        {
            None => input.insert(&self.0.db).await?,
            Some(_) => {
                let input = input.reset_all();
                input.update(&self.0.db).await?
            }
        };
        add_entity_to_collection(
            &user_id.clone(),
            ChangeCollectionToEntityInput {
                creator_user_id: user_id,
                collection_name: DefaultCollection::Custom.to_string(),
                entity_id: exercise.id.clone(),
                entity_lot: EntityLot::Exercise,
                ..Default::default()
            },
            &self.0,
        )
        .await?;
        Ok(exercise.id)
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
        self.0
            .perform_application_job(ApplicationJob::ReEvaluateUserWorkouts(user_id))
            .await?;
        Ok(true)
    }

    pub async fn re_evaluate_user_workouts(&self, user_id: String) -> Result<()> {
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
            ryot_log!(debug, "Re-evaluated workout: {}/{}", idx + 1, total);
        }
        Ok(())
    }

    pub async fn update_custom_exercise(
        &self,
        user_id: String,
        input: UpdateCustomExerciseInput,
    ) -> Result<bool> {
        let entities = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(&user_id))
            .filter(user_to_entity::Column::ExerciseId.eq(input.old_name.clone()))
            .all(&self.0.db)
            .await?;
        let old_exercise = Exercise::find_by_id(input.old_name.clone())
            .one(&self.0.db)
            .await?
            .unwrap();
        if input.should_delete.unwrap_or_default() {
            for entity in entities {
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
            }
            old_exercise.delete(&self.0.db).await?;
            return Ok(true);
        }
        if input.old_name != input.update.id {
            if Exercise::find_by_id(input.update.id.clone())
                .one(&self.0.db)
                .await?
                .is_some()
            {
                return Err(Error::new("Exercise with the new name already exists."));
            }
            Exercise::update_many()
                .col_expr(exercise::Column::Id, Expr::value(input.update.id.clone()))
                .filter(exercise::Column::Id.eq(input.old_name.clone()))
                .exec(&self.0.db)
                .await?;
            for entity in entities {
                for workout in entity.exercise_extra_information.unwrap().history {
                    let db_workout = Workout::find_by_id(workout.workout_id)
                        .one(&self.0.db)
                        .await?
                        .unwrap();
                    let mut summary = db_workout.summary.clone();
                    let mut information = db_workout.information.clone();
                    summary.exercises[workout.idx].name = input.update.id.clone();
                    information.exercises[workout.idx].name = input.update.id.clone();
                    let mut db_workout: workout::ActiveModel = db_workout.into();
                    db_workout.summary = ActiveValue::Set(summary);
                    db_workout.information = ActiveValue::Set(information);
                    db_workout.update(&self.0.db).await?;
                }
            }
        }
        for image in old_exercise.attributes.internal_images {
            if let StoredUrl::S3(key) = image {
                self.0.file_storage_service.delete_object(key).await;
            }
        }
        self.create_custom_exercise(user_id, input.update.clone())
            .await?;
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
}
