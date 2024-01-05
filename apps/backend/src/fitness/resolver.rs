use std::{
    fs::File,
    io::{BufWriter, Write},
    sync::Arc,
};

use apalis::{prelude::Storage, sqlite::SqliteStorage};
use async_graphql::{Context, Enum, Error, InputObject, Object, Result, SimpleObject};
use database::{
    AliasedExercise, ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot,
    ExerciseMechanic, ExerciseMuscle, ExerciseSource,
};
use futures::TryStreamExt;
use itertools::Itertools;
use nanoid::nanoid;
use sea_orm::{
    prelude::DateTimeUtc, ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection,
    EntityTrait, ModelTrait, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait,
    RelationTrait,
};
use sea_query::{Alias, Condition, Expr, Func, JoinType};
use serde::{Deserialize, Serialize};
use slug::slugify;
use strum::IntoEnumIterator;
use tracing::instrument;

use crate::{
    background::ApplicationJob,
    entities::{
        collection,
        exercise::{self, ExerciseListItem},
        prelude::{Exercise, UserMeasurement, UserToEntity, Workout},
        user::UserWithOnlyPreferences,
        user_measurement, user_to_entity, workout,
    },
    file_storage::FileStorageService,
    miscellaneous::DefaultCollection,
    models::{
        fitness::{
            Exercise as GithubExercise, ExerciseAttributes, ExerciseCategory,
            GithubExerciseAttributes, UserExerciseInput, UserWorkoutInput, UserWorkoutSetRecord,
            WorkoutListItem, WorkoutSetRecord,
        },
        ChangeCollectionToEntityInput, EntityLot, SearchDetails, SearchInput, SearchResults,
        StoredUrl,
    },
    traits::{AuthProvider, GraphqlRepresentation},
    utils::{add_entity_to_collection, entity_in_collections, get_ilike_query, partial_user_by_id},
};

static JSON_URL: &str =
    "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json";
static IMAGES_PREFIX_URL: &str =
    "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises";

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct ExerciseListFilter {
    #[graphql(name = "type")]
    lot: Option<ExerciseLot>,
    level: Option<ExerciseLevel>,
    force: Option<ExerciseForce>,
    mechanic: Option<ExerciseMechanic>,
    equipment: Option<ExerciseEquipment>,
    muscle: Option<ExerciseMuscle>,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
enum ExerciseSortBy {
    #[default]
    LastPerformed,
    NumTimesPerformed,
    Name,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct ExercisesListInput {
    search: SearchInput,
    filter: Option<ExerciseListFilter>,
    sort_by: Option<ExerciseSortBy>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct ExerciseParameters {
    /// All filters applicable to an exercises query.
    filters: ExerciseFilters,
    download_required: bool,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct ExerciseFilters {
    #[graphql(name = "type")]
    lot: Vec<ExerciseLot>,
    level: Vec<ExerciseLevel>,
    force: Vec<ExerciseForce>,
    mechanic: Vec<ExerciseMechanic>,
    equipment: Vec<ExerciseEquipment>,
    muscle: Vec<ExerciseMuscle>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct UserMeasurementsListInput {
    start_time: Option<DateTimeUtc>,
    end_time: Option<DateTimeUtc>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct UserExerciseHistoryInformation {
    workout_id: String,
    workout_name: String,
    workout_time: DateTimeUtc,
    index: usize,
    sets: Vec<WorkoutSetRecord>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct UserExerciseDetails {
    details: Option<user_to_entity::Model>,
    history: Option<Vec<UserExerciseHistoryInformation>>,
    collections: Vec<collection::Model>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct UserExerciseDetailsInput {
    exercise_id: String,
    /// The number of elements to return in the history.
    take_history: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
struct EditUserWorkoutInput {
    id: String,
    start_time: Option<DateTimeUtc>,
    end_time: Option<DateTimeUtc>,
}

#[derive(Default)]
pub struct ExerciseQuery;

#[Object]
impl ExerciseQuery {
    /// Get all the parameters related to exercises.
    async fn exercise_parameters(&self, gql_ctx: &Context<'_>) -> Result<ExerciseParameters> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        service.exercise_parameters().await
    }

    /// Get a paginated list of exercises in the database.
    async fn exercises_list(
        &self,
        gql_ctx: &Context<'_>,
        input: ExercisesListInput,
    ) -> Result<SearchResults<ExerciseListItem>> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.exercises_list(input, user_id).await
    }

    /// Get a paginated list of workouts done by the user.
    async fn user_workout_list(
        &self,
        gql_ctx: &Context<'_>,
        input: SearchInput,
    ) -> Result<SearchResults<WorkoutListItem>> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.user_workout_list(user_id, input).await
    }

    /// Get details about an exercise.
    async fn exercise_details(
        &self,
        gql_ctx: &Context<'_>,
        exercise_id: String,
    ) -> Result<exercise::Model> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        service.exercise_details(exercise_id).await
    }

    /// Get details about a workout.
    async fn workout_details(
        &self,
        gql_ctx: &Context<'_>,
        workout_id: String,
    ) -> Result<workout::Model> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.workout_details(workout_id, user_id).await
    }

    /// Get information about an exercise for a user.
    async fn user_exercise_details(
        &self,
        gql_ctx: &Context<'_>,
        input: UserExerciseDetailsInput,
    ) -> Result<UserExerciseDetails> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.user_exercise_details(user_id, input).await
    }

    /// Get all the measurements for a user.
    async fn user_measurements_list(
        &self,
        gql_ctx: &Context<'_>,
        input: UserMeasurementsListInput,
    ) -> Result<Vec<user_measurement::Model>> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.user_measurements_list(user_id, input).await
    }
}

#[derive(Default)]
pub struct ExerciseMutation;

#[Object]
impl ExerciseMutation {
    /// Create a user measurement.
    async fn create_user_measurement(
        &self,
        gql_ctx: &Context<'_>,
        input: user_measurement::Model,
    ) -> Result<DateTimeUtc> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.create_user_measurement(user_id, input).await
    }

    /// Delete a user measurement.
    async fn delete_user_measurement(
        &self,
        gql_ctx: &Context<'_>,
        timestamp: DateTimeUtc,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.delete_user_measurement(user_id, timestamp).await
    }

    /// Take a user workout, process it and commit it to database.
    async fn create_user_workout(
        &self,
        gql_ctx: &Context<'_>,
        input: UserWorkoutInput,
    ) -> Result<String> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.create_user_workout(user_id, input).await
    }

    /// Change the details about a user's workout.
    async fn edit_user_workout(
        &self,
        gql_ctx: &Context<'_>,
        input: EditUserWorkoutInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.edit_user_workout(user_id, input).await
    }

    /// Delete a workout and remove all exercise associations.
    async fn delete_user_workout(&self, gql_ctx: &Context<'_>, workout_id: String) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.delete_user_workout(user_id, workout_id).await
    }

    /// Create a custom exercise.
    async fn create_custom_exercise(
        &self,
        gql_ctx: &Context<'_>,
        input: exercise::Model,
    ) -> Result<String> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.create_custom_exercise(user_id, input).await
    }
}

pub struct ExerciseService {
    db: DatabaseConnection,
    config: Arc<config::AppConfig>,
    file_storage_service: Arc<FileStorageService>,
    perform_application_job: SqliteStorage<ApplicationJob>,
}

impl AuthProvider for ExerciseService {}

impl ExerciseService {
    pub fn new(
        db: &DatabaseConnection,
        config: Arc<config::AppConfig>,
        file_storage_service: Arc<FileStorageService>,
        perform_application_job: &SqliteStorage<ApplicationJob>,
    ) -> Self {
        Self {
            db: db.clone(),
            config,
            file_storage_service,
            perform_application_job: perform_application_job.clone(),
        }
    }
}

impl ExerciseService {
    async fn exercise_parameters(&self) -> Result<ExerciseParameters> {
        let download_required = Exercise::find().count(&self.db).await? == 0;
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
        })
    }

    async fn get_all_exercises_from_dataset(&self) -> Result<Vec<GithubExercise>> {
        let data: Vec<GithubExercise> = surf::get(JSON_URL)
            .send()
            .await
            .unwrap()
            .body_json()
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

    async fn exercise_details(&self, exercise_id: String) -> Result<exercise::Model> {
        let maybe_exercise = Exercise::find_by_id(exercise_id).one(&self.db).await?;
        match maybe_exercise {
            None => Err(Error::new("Exercise with the given ID could not be found.")),
            Some(e) => Ok(e.graphql_repr(&self.file_storage_service).await?),
        }
    }

    async fn workout_details(&self, workout_id: String, user_id: i32) -> Result<workout::Model> {
        let maybe_workout = Workout::find_by_id(workout_id)
            .filter(workout::Column::UserId.eq(user_id))
            .one(&self.db)
            .await?;
        match maybe_workout {
            None => Err(Error::new(
                "Workout with the given ID could not be found for this user.",
            )),
            Some(e) => Ok(e.graphql_repr(&self.file_storage_service).await?),
        }
    }

    async fn user_exercise_details(
        &self,
        user_id: i32,
        input: UserExerciseDetailsInput,
    ) -> Result<UserExerciseDetails> {
        let collections = entity_in_collections(
            &self.db,
            user_id,
            input.exercise_id.clone(),
            EntityLot::Exercise,
        )
        .await?;
        let mut resp = UserExerciseDetails {
            details: None,
            history: None,
            collections,
        };
        if let Some(association) = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .filter(user_to_entity::Column::ExerciseId.eq(input.exercise_id))
            .one(&self.db)
            .await?
        {
            let user_to_exercise_extra_information =
                association.exercise_extra_information.clone().unwrap();
            let workouts = Workout::find()
                .filter(
                    workout::Column::Id.is_in(
                        user_to_exercise_extra_information
                            .history
                            .iter()
                            .map(|h| h.workout_id.clone()),
                    ),
                )
                .limit(input.take_history)
                .order_by_desc(workout::Column::EndTime)
                .all(&self.db)
                .await?;
            let history = workouts
                .into_iter()
                .map(|w| {
                    let element = user_to_exercise_extra_information
                        .history
                        .iter()
                        .find(|h| h.workout_id == w.id)
                        .unwrap();
                    UserExerciseHistoryInformation {
                        workout_id: w.id,
                        workout_name: w.name,
                        workout_time: w.start_time,
                        index: element.idx,
                        sets: w.information.exercises[element.idx].sets.clone(),
                    }
                })
                .collect_vec();
            resp.history = Some(history);
            resp.details = Some(association);
        }
        Ok(resp)
    }

    async fn user_workout_list(
        &self,
        user_id: i32,
        input: SearchInput,
    ) -> Result<SearchResults<WorkoutListItem>> {
        let page = input.page.unwrap_or(1);
        let query = Workout::find()
            .filter(workout::Column::UserId.eq(user_id))
            .apply_if(input.query, |query, v| {
                query.filter(get_ilike_query(Expr::col(workout::Column::Name), &v))
            })
            .order_by_desc(workout::Column::EndTime);
        let total = query.clone().count(&self.db).await?;
        let total: i32 = total.try_into().unwrap();
        let data = query
            .into_partial_model::<WorkoutListItem>()
            .paginate(&self.db, self.config.frontend.page_size.try_into().unwrap());
        let items = data.fetch_page((page - 1).try_into().unwrap()).await?;
        let next_page = if total - (page * self.config.frontend.page_size) > 0 {
            Some(page + 1)
        } else {
            None
        };
        Ok(SearchResults {
            details: SearchDetails { total, next_page },
            items,
        })
    }

    async fn exercises_list(
        &self,
        input: ExercisesListInput,
        user_id: i32,
    ) -> Result<SearchResults<ExerciseListItem>> {
        let ex = Alias::new("exercise");
        let etu = Alias::new("user_to_entity");
        let order_by_col = match input.sort_by {
            None => Expr::col((ex, exercise::Column::Id)),
            Some(sb) => match sb {
                // DEV: This is just a small hack to reduce duplicated code. We
                // are ordering by name for the other `sort_by` anyway.
                ExerciseSortBy::Name => Expr::val("1"),
                ExerciseSortBy::NumTimesPerformed => Expr::expr(Func::coalesce([
                    Expr::col((etu.clone(), user_to_entity::Column::NumTimesInteracted)).into(),
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
                Expr::col((etu.clone(), user_to_entity::Column::NumTimesInteracted)),
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
                        q.filter(get_ilike_query(
                            Func::cast_as(Expr::col(exercise::Column::Muscles), Alias::new("text")),
                            &v.to_string(),
                        ))
                    })
                    .apply_if(q.level, |q, v| q.filter(exercise::Column::Level.eq(v)))
                    .apply_if(q.force, |q, v| q.filter(exercise::Column::Force.eq(v)))
                    .apply_if(q.mechanic, |q, v| {
                        q.filter(exercise::Column::Mechanic.eq(v))
                    })
                    .apply_if(q.equipment, |q, v| {
                        q.filter(exercise::Column::Equipment.eq(v))
                    })
            })
            .apply_if(input.search.query, |query, v| {
                query.filter(
                    Condition::any()
                        .add(get_ilike_query(
                            Expr::col((AliasedExercise::Table, exercise::Column::Id)),
                            &v,
                        ))
                        .add(get_ilike_query(
                            Expr::col(exercise::Column::Identifier),
                            &slugify(v),
                        )),
                )
            })
            .join(
                JoinType::LeftJoin,
                user_to_entity::Relation::Exercise
                    .def()
                    .rev()
                    .on_condition(move |_left, right| {
                        Condition::all()
                            .add(Expr::col((right, user_to_entity::Column::UserId)).eq(user_id))
                    }),
            )
            .order_by_desc(order_by_col)
            .order_by_asc(exercise::Column::Id);
        let total = query.clone().count(&self.db).await?;
        let total: i32 = total.try_into().unwrap();
        let data = query
            .into_model::<ExerciseListItem>()
            .paginate(&self.db, self.config.frontend.page_size.try_into().unwrap());
        let mut items = vec![];
        for ex in data
            .fetch_page((input.search.page.unwrap() - 1).try_into().unwrap())
            .await?
        {
            let gql_repr = ex.graphql_repr(&self.file_storage_service).await?;
            items.push(gql_repr);
        }
        let next_page =
            if total - ((input.search.page.unwrap()) * self.config.frontend.page_size) > 0 {
                Some(input.search.page.unwrap() + 1)
            } else {
                None
            };
        Ok(SearchResults {
            details: SearchDetails { total, next_page },
            items,
        })
    }

    #[instrument(skip(self))]
    pub async fn deploy_update_exercise_library_job(&self) -> Result<i32> {
        let exercises = self.get_all_exercises_from_dataset().await?;
        let mut job_ids = vec![];
        for exercise in exercises {
            let job = self
                .perform_application_job
                .clone()
                .push(ApplicationJob::UpdateExerciseJob(exercise))
                .await?;
            tracing::trace!(job_id = ?job, "Deployed job to update exercise library.");
            job_ids.push(job.to_string());
        }
        Ok(job_ids.len().try_into().unwrap())
    }

    #[instrument(skip(self, ex))]
    pub async fn update_exercise(&self, ex: GithubExercise) -> Result<()> {
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
            .one(&self.db)
            .await?
        {
            tracing::trace!(
                "Updating existing exercise with identifier: {}",
                ex.identifier
            );
            let mut db_ex: exercise::ActiveModel = e.into();
            db_ex.attributes = ActiveValue::Set(attributes);
            db_ex.muscles = ActiveValue::Set(muscles);
            db_ex.update(&self.db).await?;
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
            };
            let created_exercise = db_exercise.insert(&self.db).await?;
            tracing::trace!("Created new exercise with id: {}", created_exercise.id);
        }
        Ok(())
    }

    pub async fn export_measurements(
        &self,
        user_id: i32,
        writer: &mut BufWriter<File>,
    ) -> Result<bool> {
        let resp = self
            .user_measurements_list(
                user_id,
                UserMeasurementsListInput {
                    start_time: None,
                    end_time: None,
                },
            )
            .await?;
        let mut to_write = serde_json::to_string(&resp).unwrap();
        to_write.remove(0);
        to_write.pop();
        writer.write_all(to_write.as_bytes()).unwrap();
        Ok(true)
    }

    async fn user_measurements_list(
        &self,
        user_id: i32,
        input: UserMeasurementsListInput,
    ) -> Result<Vec<user_measurement::Model>> {
        let resp = UserMeasurement::find()
            .apply_if(input.start_time, |query, v| {
                query.filter(user_measurement::Column::Timestamp.lte(v))
            })
            .apply_if(input.end_time, |query, v| {
                query.filter(user_measurement::Column::Timestamp.gte(v))
            })
            .filter(user_measurement::Column::UserId.eq(user_id))
            .order_by_asc(user_measurement::Column::Timestamp)
            .all(&self.db)
            .await?;
        Ok(resp)
    }

    async fn create_user_measurement(
        &self,
        user_id: i32,
        mut input: user_measurement::Model,
    ) -> Result<DateTimeUtc> {
        input.user_id = user_id;
        let um: user_measurement::ActiveModel = input.into();
        let um = um.insert(&self.db).await?;
        Ok(um.timestamp)
    }

    async fn delete_user_measurement(&self, user_id: i32, timestamp: DateTimeUtc) -> Result<bool> {
        if let Some(m) = UserMeasurement::find_by_id((timestamp, user_id))
            .one(&self.db)
            .await?
        {
            m.delete(&self.db).await?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    #[instrument(skip(self, input))]
    pub async fn create_user_workout(
        &self,
        user_id: i32,
        input: UserWorkoutInput,
    ) -> Result<String> {
        let user = partial_user_by_id::<UserWithOnlyPreferences>(&self.db, user_id).await?;
        let id = nanoid!(12);
        tracing::trace!("Creating new workout with id: {}", id);
        let identifier = input
            .calculate_and_commit(
                user_id,
                &self.db,
                user.preferences.fitness.exercises.save_history,
            )
            .await?;
        Ok(identifier)
    }

    async fn edit_user_workout(&self, user_id: i32, input: EditUserWorkoutInput) -> Result<bool> {
        if let Some(wkt) = Workout::find()
            .filter(workout::Column::UserId.eq(user_id))
            .filter(workout::Column::Id.eq(input.id))
            .one(&self.db)
            .await?
        {
            let mut new_wkt: workout::ActiveModel = wkt.into();
            if let Some(d) = input.start_time {
                new_wkt.start_time = ActiveValue::Set(d);
            }
            if let Some(d) = input.end_time {
                new_wkt.end_time = ActiveValue::Set(d);
            }
            if new_wkt.is_changed() {
                new_wkt.update(&self.db).await?;
                Ok(true)
            } else {
                Ok(false)
            }
        } else {
            Err(Error::new("Workout does not exist for user"))
        }
    }

    async fn create_custom_exercise(&self, user_id: i32, input: exercise::Model) -> Result<String> {
        let mut input = input;
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
        let exercise = input.insert(&self.db).await?;
        add_entity_to_collection(
            &self.db,
            user_id,
            ChangeCollectionToEntityInput {
                collection_name: DefaultCollection::Custom.to_string(),
                entity_id: exercise.id.clone(),
                entity_lot: EntityLot::Exercise,
            },
        )
        .await?;
        Ok(exercise.id)
    }

    pub async fn export_workouts(
        &self,
        user_id: i32,
        writer: &mut BufWriter<File>,
    ) -> Result<bool> {
        let workout_ids = Workout::find()
            .select_only()
            .column(workout::Column::Id)
            .filter(workout::Column::UserId.eq(user_id))
            .order_by_desc(workout::Column::EndTime)
            .into_tuple::<String>()
            .all(&self.db)
            .await?;
        let mut workouts = vec![];
        for workout_id in workout_ids {
            workouts.push(self.workout_details(workout_id, user_id).await?);
        }
        let mut to_write = serde_json::to_string(&workouts).unwrap();
        to_write.remove(0);
        to_write.pop();
        writer.write_all(to_write.as_bytes()).unwrap();
        Ok(true)
    }

    pub async fn delete_user_workout(&self, user_id: i32, workout_id: String) -> Result<bool> {
        if let Some(wkt) = Workout::find()
            .filter(workout::Column::UserId.eq(user_id))
            .filter(workout::Column::Id.eq(workout_id))
            .one(&self.db)
            .await?
        {
            wkt.delete_existing(&self.db, user_id).await?;
            Ok(true)
        } else {
            Err(Error::new("Workout does not exist for user"))
        }
    }

    pub async fn re_evaluate_user_workouts(&self, user_id: i32) -> Result<()> {
        UserToEntity::delete_many()
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .filter(user_to_entity::Column::ExerciseId.is_not_null())
            .exec(&self.db)
            .await?;
        let workouts = Workout::find()
            .filter(workout::Column::UserId.eq(user_id))
            .order_by_asc(workout::Column::EndTime)
            .all(&self.db)
            .await?;
        let total = workouts.len();
        for (idx, workout) in workouts.into_iter().enumerate() {
            workout.clone().delete(&self.db).await?;
            let workout_input = UserWorkoutInput {
                id: Some(workout.id),
                name: workout.name,
                comment: workout.comment,
                start_time: workout.start_time,
                repeated_from: workout.repeated_from,
                end_time: workout.end_time,
                exercises: workout
                    .information
                    .exercises
                    .into_iter()
                    .map(|e| UserExerciseInput {
                        exercise_id: e.name,
                        sets: e
                            .sets
                            .into_iter()
                            .map(|s| UserWorkoutSetRecord {
                                statistic: s.statistic,
                                lot: s.lot,
                                confirmed_at: s.confirmed_at,
                            })
                            .collect(),
                        notes: e.notes,
                        rest_time: e.rest_time,
                        assets: e.assets,
                        superset_with: e.superset_with,
                    })
                    .collect(),
                assets: workout.information.assets,
            };
            self.create_user_workout(user_id, workout_input).await?;
            tracing::trace!("Re-evaluated workout: {}/{}", idx + 1, total);
        }
        let mut all_associations = UserToEntity::find()
            .filter(user_to_entity::Column::ExerciseId.is_not_null())
            .stream(&self.db)
            .await?;
        while let Some(association) = all_associations.try_next().await? {
            let workout_date = Workout::find_by_id(
                association
                    .exercise_extra_information
                    .clone()
                    .unwrap()
                    .history
                    .first()
                    .cloned()
                    .unwrap()
                    .workout_id,
            )
            .one(&self.db)
            .await?
            .unwrap()
            .start_time;
            let mut association: user_to_entity::ActiveModel = association.into();
            association.last_updated_on = ActiveValue::Set(workout_date);
            association.update(&self.db).await?;
        }
        Ok(())
    }
}
