use std::{fs::File, sync::Arc};

use apalis::prelude::{MemoryStorage, MessageQueue};
use async_graphql::{Context, Enum, Error, InputObject, Object, Result, SimpleObject};
use enums::{
    ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMechanic, ExerciseMuscle,
    ExerciseSource,
};
use itertools::Itertools;
use migrations::AliasedExercise;
use models::{
    collection, collection_to_entity, exercise,
    prelude::{CollectionToEntity, Exercise, UserMeasurement, UserToEntity, Workout},
    user_measurement, user_to_entity, workout, ChangeCollectionToEntityInput, DefaultCollection,
    ExerciseAttributes, ExerciseCategory, ExerciseListItem, GithubExercise,
    GithubExerciseAttributes, SearchDetails, SearchInput, SearchResults, StoredUrl,
    UserExerciseInput, UserToExerciseHistoryExtraInformation, UserWorkoutInput,
    UserWorkoutSetRecord,
};
use sea_orm::{
    prelude::DateTimeUtc, ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection,
    EntityTrait, Iterable, ModelTrait, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect,
    QueryTrait, RelationTrait,
};
use sea_query::{extension::postgres::PgExpr, Alias, Condition, Expr, Func, JoinType};
use serde::{Deserialize, Serialize};
use services::FileStorageService;
use slug::slugify;
use struson::writer::{JsonStreamWriter, JsonWriter};
use traits::AuthProvider;
use utils::GraphqlRepresentation;

use crate::{
    app_utils::{add_entity_to_collection, entity_in_collections, ilike_sql, user_by_id},
    background::{ApplicationJob, CoreApplicationJob},
};

use super::logic::{calculate_and_commit, delete_existing_workout};

const EXERCISE_DB_URL: &str = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main";
const JSON_URL: &str = const_str::concat!(EXERCISE_DB_URL, "/dist/exercises.json");
const IMAGES_PREFIX_URL: &str = const_str::concat!(EXERCISE_DB_URL, "/exercises");

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
struct ExerciseListFilter {
    #[graphql(name = "type")]
    lot: Option<ExerciseLot>,
    level: Option<ExerciseLevel>,
    force: Option<ExerciseForce>,
    mechanic: Option<ExerciseMechanic>,
    equipment: Option<ExerciseEquipment>,
    muscle: Option<ExerciseMuscle>,
    collection: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
enum ExerciseSortBy {
    Name,
    #[default]
    LastPerformed,
    TimesPerformed,
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
struct UserExerciseDetails {
    details: Option<user_to_entity::Model>,
    history: Option<Vec<UserToExerciseHistoryExtraInformation>>,
    collections: Vec<collection::Model>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct UserWorkoutDetails {
    details: workout::Model,
    collections: Vec<collection::Model>,
}

#[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
struct UpdateUserWorkoutInput {
    id: String,
    start_time: Option<DateTimeUtc>,
    end_time: Option<DateTimeUtc>,
}

#[derive(Clone, Debug, Deserialize, Serialize, InputObject)]
struct UpdateCustomExerciseInput {
    old_name: String,
    should_delete: Option<bool>,
    #[graphql(flatten)]
    update: exercise::Model,
}

#[derive(Default)]
pub struct ExerciseQuery;

impl AuthProvider for ExerciseQuery {}

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
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.exercises_list(user_id, input).await
    }

    /// Get a paginated list of workouts done by the user.
    async fn user_workouts_list(
        &self,
        gql_ctx: &Context<'_>,
        input: SearchInput,
    ) -> Result<SearchResults<workout::Model>> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.user_workouts_list(user_id, input).await
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
    ) -> Result<UserWorkoutDetails> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.workout_details(&user_id, workout_id).await
    }

    /// Get information about an exercise for a user.
    async fn user_exercise_details(
        &self,
        gql_ctx: &Context<'_>,
        exercise_id: String,
    ) -> Result<UserExerciseDetails> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.user_exercise_details(user_id, exercise_id).await
    }

    /// Get all the measurements for a user.
    async fn user_measurements_list(
        &self,
        gql_ctx: &Context<'_>,
        input: UserMeasurementsListInput,
    ) -> Result<Vec<user_measurement::Model>> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.user_measurements_list(&user_id, input).await
    }
}

#[derive(Default)]
pub struct ExerciseMutation;

impl AuthProvider for ExerciseMutation {
    fn is_mutation(&self) -> bool {
        true
    }
}

#[Object]
impl ExerciseMutation {
    /// Create a user measurement.
    async fn create_user_measurement(
        &self,
        gql_ctx: &Context<'_>,
        input: user_measurement::Model,
    ) -> Result<DateTimeUtc> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.create_user_measurement(&user_id, input).await
    }

    /// Delete a user measurement.
    async fn delete_user_measurement(
        &self,
        gql_ctx: &Context<'_>,
        timestamp: DateTimeUtc,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.delete_user_measurement(user_id, timestamp).await
    }

    /// Take a user workout, process it and commit it to database.
    async fn create_user_workout(
        &self,
        gql_ctx: &Context<'_>,
        input: UserWorkoutInput,
    ) -> Result<String> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.create_user_workout(&user_id, input).await
    }

    /// Change the details about a user's workout.
    async fn update_user_workout(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateUserWorkoutInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.update_user_workout(user_id, input).await
    }

    /// Delete a workout and remove all exercise associations.
    async fn delete_user_workout(&self, gql_ctx: &Context<'_>, workout_id: String) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.delete_user_workout(user_id, workout_id).await
    }

    /// Create a custom exercise.
    async fn create_custom_exercise(
        &self,
        gql_ctx: &Context<'_>,
        input: exercise::Model,
    ) -> Result<String> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.create_custom_exercise(user_id, input).await
    }

    /// Update a custom exercise.
    async fn update_custom_exercise(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateCustomExerciseInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.update_custom_exercise(user_id, input).await
    }
}

pub struct ExerciseService {
    db: DatabaseConnection,
    config: Arc<config::AppConfig>,
    file_storage_service: Arc<FileStorageService>,
    perform_application_job: MemoryStorage<ApplicationJob>,
    perform_core_application_job: MemoryStorage<CoreApplicationJob>,
}

impl ExerciseService {
    pub fn new(
        db: &DatabaseConnection,
        config: Arc<config::AppConfig>,
        file_storage_service: Arc<FileStorageService>,
        perform_application_job: &MemoryStorage<ApplicationJob>,
        perform_core_application_job: &MemoryStorage<CoreApplicationJob>,
    ) -> Self {
        Self {
            config,
            db: db.clone(),
            file_storage_service,
            perform_application_job: perform_application_job.clone(),
            perform_core_application_job: perform_core_application_job.clone(),
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

    async fn exercise_details(&self, exercise_id: String) -> Result<exercise::Model> {
        let maybe_exercise = Exercise::find_by_id(exercise_id).one(&self.db).await?;
        match maybe_exercise {
            None => Err(Error::new("Exercise with the given ID could not be found.")),
            Some(e) => Ok(e.graphql_representation(&self.file_storage_service).await?),
        }
    }

    async fn workout_details(
        &self,
        user_id: &String,
        workout_id: String,
    ) -> Result<UserWorkoutDetails> {
        let maybe_workout = Workout::find_by_id(workout_id.clone())
            .filter(workout::Column::UserId.eq(user_id))
            .one(&self.db)
            .await?;
        match maybe_workout {
            None => Err(Error::new(
                "Workout with the given ID could not be found for this user.",
            )),
            Some(e) => {
                let collections = entity_in_collections(
                    &self.db,
                    user_id,
                    None,
                    None,
                    None,
                    None,
                    Some(workout_id),
                )
                .await?;
                let details = e.graphql_representation(&self.file_storage_service).await?;
                Ok(UserWorkoutDetails {
                    details,
                    collections,
                })
            }
        }
    }

    async fn user_exercise_details(
        &self,
        user_id: String,
        exercise_id: String,
    ) -> Result<UserExerciseDetails> {
        let collections = entity_in_collections(
            &self.db,
            &user_id,
            None,
            None,
            None,
            Some(exercise_id.clone()),
            None,
        )
        .await?;
        let mut resp = UserExerciseDetails {
            details: None,
            history: None,
            collections,
        };
        if let Some(association) = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .filter(user_to_entity::Column::ExerciseId.eq(exercise_id))
            .one(&self.db)
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

    async fn user_workouts_list(
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
        let total = query.clone().count(&self.db).await?;
        let total: i32 = total.try_into().unwrap();
        let data = query.paginate(&self.db, self.config.frontend.page_size.try_into().unwrap());
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
                        q.filter(
                            Expr::expr(Func::cast_as(
                                Expr::col(exercise::Column::Muscles),
                                Alias::new("text"),
                            ))
                            .ilike(ilike_sql(&v.to_string())),
                        )
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
            let gql_repr = ex
                .graphql_representation(&self.file_storage_service)
                .await?;
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

    #[tracing::instrument(skip(self))]
    pub async fn deploy_update_exercise_library_job(&self) -> Result<bool> {
        let exercises = self.get_all_exercises_from_dataset().await?;
        for exercise in exercises {
            self.perform_application_job
                .clone()
                .enqueue(ApplicationJob::UpdateGithubExerciseJob(exercise))
                .await
                .unwrap();
        }
        Ok(true)
    }

    #[tracing::instrument(skip(self, ex))]
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
            .one(&self.db)
            .await?
        {
            tracing::debug!(
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
                created_by_user_id: ActiveValue::Set(None),
            };
            let created_exercise = db_exercise.insert(&self.db).await?;
            tracing::debug!("Created new exercise with id: {}", created_exercise.id);
        }
        Ok(())
    }

    pub async fn export_measurements(
        &self,
        user_id: &String,
        writer: &mut JsonStreamWriter<File>,
    ) -> Result<bool> {
        let measurements = self
            .user_measurements_list(
                user_id,
                UserMeasurementsListInput {
                    start_time: None,
                    end_time: None,
                },
            )
            .await?;
        for measurement in measurements {
            writer.serialize_value(&measurement).unwrap();
        }
        Ok(true)
    }

    async fn user_measurements_list(
        &self,
        user_id: &String,
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

    pub async fn create_user_measurement(
        &self,
        user_id: &String,
        mut input: user_measurement::Model,
    ) -> Result<DateTimeUtc> {
        input.user_id = user_id.to_owned();
        let um: user_measurement::ActiveModel = input.into();
        let um = um.insert(&self.db).await?;
        Ok(um.timestamp)
    }

    async fn delete_user_measurement(
        &self,
        user_id: String,
        timestamp: DateTimeUtc,
    ) -> Result<bool> {
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

    #[tracing::instrument(skip(self, input))]
    pub async fn create_user_workout(
        &self,
        user_id: &String,
        input: UserWorkoutInput,
    ) -> Result<String> {
        let preferences = user_by_id(&self.db, user_id).await?.preferences;
        let identifier = calculate_and_commit(
            input,
            user_id,
            &self.db,
            preferences.fitness.exercises.save_history,
        )
        .await?;
        Ok(identifier)
    }

    async fn update_user_workout(
        &self,
        user_id: String,
        input: UpdateUserWorkoutInput,
    ) -> Result<bool> {
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

    async fn create_custom_exercise(
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
            .one(&self.db)
            .await?
        {
            None => input.insert(&self.db).await?,
            Some(_) => {
                let input = input.reset_all();
                input.update(&self.db).await?
            }
        };
        add_entity_to_collection(
            &self.db,
            &user_id.clone(),
            ChangeCollectionToEntityInput {
                creator_user_id: user_id,
                collection_name: DefaultCollection::Custom.to_string(),
                exercise_id: Some(exercise.id.clone()),
                ..Default::default()
            },
            &self.perform_core_application_job,
        )
        .await?;
        Ok(exercise.id)
    }

    pub async fn export_workouts(
        &self,
        user_id: &String,
        writer: &mut JsonStreamWriter<File>,
    ) -> Result<bool> {
        let workout_ids = Workout::find()
            .select_only()
            .column(workout::Column::Id)
            .filter(workout::Column::UserId.eq(user_id))
            .order_by_desc(workout::Column::EndTime)
            .into_tuple::<String>()
            .all(&self.db)
            .await?;
        for workout_id in workout_ids {
            let details = self.workout_details(user_id, workout_id).await?;
            writer.serialize_value(&details).unwrap();
        }
        Ok(true)
    }

    pub async fn delete_user_workout(&self, user_id: String, workout_id: String) -> Result<bool> {
        if let Some(wkt) = Workout::find_by_id(workout_id)
            .filter(workout::Column::UserId.eq(&user_id))
            .one(&self.db)
            .await?
        {
            delete_existing_workout(wkt, &self.db, user_id).await?;
            Ok(true)
        } else {
            Err(Error::new("Workout does not exist for user"))
        }
    }

    pub async fn re_evaluate_user_workouts(&self, user_id: String) -> Result<()> {
        UserToEntity::delete_many()
            .filter(user_to_entity::Column::UserId.eq(&user_id))
            .filter(user_to_entity::Column::ExerciseId.is_not_null())
            .exec(&self.db)
            .await?;
        let workouts = Workout::find()
            .filter(workout::Column::UserId.eq(&user_id))
            .order_by_asc(workout::Column::EndTime)
            .all(&self.db)
            .await?;
        let total = workouts.len();
        for (idx, workout) in workouts.into_iter().enumerate() {
            workout.clone().delete(&self.db).await?;
            let workout_input = self.db_workout_to_workout_input(workout);
            self.create_user_workout(&user_id, workout_input).await?;
            tracing::debug!("Re-evaluated workout: {}/{}", idx + 1, total);
        }
        Ok(())
    }

    pub fn db_workout_to_workout_input(&self, user_workout: workout::Model) -> UserWorkoutInput {
        UserWorkoutInput {
            name: user_workout.name,
            id: Some(user_workout.id),
            end_time: user_workout.end_time,
            start_time: user_workout.start_time,
            assets: user_workout.information.assets,
            repeated_from: user_workout.repeated_from,
            comment: user_workout.information.comment,
            exercises: user_workout
                .information
                .exercises
                .into_iter()
                .map(|e| UserExerciseInput {
                    exercise_id: e.name,
                    sets: e
                        .sets
                        .into_iter()
                        .map(|s| UserWorkoutSetRecord {
                            lot: s.lot,
                            note: s.note,
                            statistic: s.statistic,
                            confirmed_at: s.confirmed_at,
                        })
                        .collect(),
                    notes: e.notes,
                    rest_time: e.rest_time,
                    assets: e.assets,
                    superset_with: e.superset_with,
                })
                .collect(),
        }
    }

    async fn update_custom_exercise(
        &self,
        user_id: String,
        input: UpdateCustomExerciseInput,
    ) -> Result<bool> {
        let entities = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(&user_id))
            .filter(user_to_entity::Column::ExerciseId.eq(input.old_name.clone()))
            .all(&self.db)
            .await?;
        let old_exercise = Exercise::find_by_id(input.old_name.clone())
            .one(&self.db)
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
            old_exercise.delete(&self.db).await?;
            return Ok(true);
        }
        if input.old_name != input.update.id {
            if Exercise::find_by_id(input.update.id.clone())
                .one(&self.db)
                .await?
                .is_some()
            {
                return Err(Error::new("Exercise with the new name already exists."));
            }
            Exercise::update_many()
                .col_expr(exercise::Column::Id, Expr::value(input.update.id.clone()))
                .filter(exercise::Column::Id.eq(input.old_name.clone()))
                .exec(&self.db)
                .await?;
            for entity in entities {
                for workout in entity.exercise_extra_information.unwrap().history {
                    let db_workout = Workout::find_by_id(workout.workout_id)
                        .one(&self.db)
                        .await?
                        .unwrap();
                    let mut summary = db_workout.summary.clone();
                    let mut information = db_workout.information.clone();
                    summary.exercises[workout.idx].id = input.update.id.clone();
                    information.exercises[workout.idx].name = input.update.id.clone();
                    let mut db_workout: workout::ActiveModel = db_workout.into();
                    db_workout.summary = ActiveValue::Set(summary);
                    db_workout.information = ActiveValue::Set(information);
                    db_workout.update(&self.db).await?;
                }
            }
        }
        for image in old_exercise.attributes.internal_images {
            match image {
                StoredUrl::S3(key) => {
                    self.file_storage_service.delete_object(key).await;
                }
                _ => continue,
            }
        }
        self.create_custom_exercise(user_id, input.update.clone())
            .await?;
        Ok(true)
    }
}
