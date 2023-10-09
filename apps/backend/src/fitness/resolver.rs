use std::sync::Arc;

use apalis::{prelude::Storage, sqlite::SqliteStorage};
use async_graphql::{Context, Enum, Error, InputObject, Object, Result, SimpleObject};
use itertools::Itertools;
use sea_orm::{
    prelude::DateTimeUtc, ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection,
    EntityTrait, ModelTrait, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait,
    RelationTrait,
};
use sea_query::{Alias, Condition, Expr, Func, JoinType};
use serde::{Deserialize, Serialize};
use sonyflake::Sonyflake;
use strum::IntoEnumIterator;
use tracing::instrument;

use crate::{
    background::ApplicationJob,
    config::AppConfig,
    entities::{
        exercise::{self, ExerciseSearchItem},
        prelude::{Exercise, UserMeasurement, UserToExercise, Workout},
        user::UserWithOnlyPreferences,
        user_measurement, user_to_exercise, workout,
    },
    file_storage::FileStorageService,
    migrator::{
        ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMechanic,
        ExerciseMuscle,
    },
    models::{
        fitness::{
            Exercise as GithubExercise, ExerciseAttributes, ExerciseCategory, ExerciseMuscles,
            GithubExerciseAttributes, WorkoutSetRecord,
        },
        SearchDetails, SearchInput, SearchResults, StoredUrl,
    },
    traits::AuthProvider,
    utils::{get_ilike_query, partial_user_by_id},
};

use super::logic::UserWorkoutInput;

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
    workout_name: Option<String>,
    workout_time: DateTimeUtc,
    sets: Vec<WorkoutSetRecord>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct UserExerciseInformation {
    details: user_to_exercise::Model,
    history: Vec<UserExerciseHistoryInformation>,
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
    ) -> Result<SearchResults<ExerciseSearchItem>> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.exercises_list(input, user_id).await
    }

    /// Get details about an exercise.
    async fn exercise_details(
        &self,
        gql_ctx: &Context<'_>,
        exercise_id: i32,
    ) -> Result<exercise::Model> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        service.exercise_details(exercise_id).await
    }

    /// Get information about an exercise for a user.
    async fn user_exercise_details(
        &self,
        gql_ctx: &Context<'_>,
        exercise_id: i32,
    ) -> Result<Option<UserExerciseInformation>> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        let user_id = service.user_id_from_ctx(gql_ctx).await?;
        service.user_exercise_details(exercise_id, user_id).await
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
    /// Deploy a job to download and update the exercise library.
    async fn deploy_update_exercise_library_job(&self, gql_ctx: &Context<'_>) -> Result<i32> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        service.deploy_update_exercise_library_job().await
    }

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
}

pub struct ExerciseService {
    db: DatabaseConnection,
    config: Arc<AppConfig>,
    file_storage_service: Arc<FileStorageService>,
    perform_application_job: SqliteStorage<ApplicationJob>,
}

impl AuthProvider for ExerciseService {}

impl ExerciseService {
    pub fn new(
        db: &DatabaseConnection,
        config: Arc<AppConfig>,
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

    async fn exercise_details(&self, exercise_id: i32) -> Result<exercise::Model> {
        let maybe_exercise = Exercise::find_by_id(exercise_id).one(&self.db).await?;
        match maybe_exercise {
            None => Err(Error::new("Exercise with the given ID could not be found.")),
            Some(e) => Ok(e.graphql_repr(&self.file_storage_service).await),
        }
    }

    async fn user_exercise_details(
        &self,
        exercise_id: i32,
        user_id: i32,
    ) -> Result<Option<UserExerciseInformation>> {
        if let Some(details) = UserToExercise::find_by_id((user_id, exercise_id))
            .one(&self.db)
            .await?
        {
            let workouts = Workout::find()
                .filter(
                    workout::Column::Id.is_in(
                        details
                            .extra_information
                            .history
                            .iter()
                            .map(|h| h.workout_id.clone()),
                    ),
                )
                .all(&self.db)
                .await?;
            let history = workouts
                .into_iter()
                .map(|w| {
                    let element = details
                        .extra_information
                        .history
                        .iter()
                        .find(|h| h.workout_id == w.id)
                        .unwrap();
                    UserExerciseHistoryInformation {
                        workout_id: w.id,
                        workout_name: w.name,
                        workout_time: w.start_time,
                        sets: w.information.exercises[element.idx].sets.clone(),
                    }
                })
                .collect();
            Ok(Some(UserExerciseInformation { details, history }))
        } else {
            Ok(None)
        }
    }

    async fn exercises_list(
        &self,
        input: ExercisesListInput,
        user_id: i32,
    ) -> Result<SearchResults<ExerciseSearchItem>> {
        let ex = Alias::new("exercise");
        let etu = Alias::new("user_to_exercise");
        let order_by_col = match input.sort_by {
            None => Expr::col((ex, exercise::Column::Name)),
            Some(sb) => match sb {
                ExerciseSortBy::Name => Expr::col((ex, exercise::Column::Name)),
                ExerciseSortBy::NumTimesPerformed => Expr::expr(Func::coalesce([
                    Expr::col((etu, user_to_exercise::Column::NumTimesPerformed)).into(),
                    Expr::val(0).into(),
                ])),
                _ => todo!(),
            },
        };
        let query = Exercise::find()
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
                    Condition::any().add(get_ilike_query(Expr::col(exercise::Column::Name), &v)),
                )
            })
            .join(
                JoinType::LeftJoin,
                user_to_exercise::Relation::Exercise
                    .def()
                    .rev()
                    .on_condition(move |_left, right| {
                        Condition::all()
                            .add(Expr::col((right, user_to_exercise::Column::UserId)).eq(user_id))
                    }),
            )
            .order_by_desc(order_by_col)
            .order_by_asc(exercise::Column::Name);
        let total = query.clone().count(&self.db).await?;
        let total: i32 = total.try_into().unwrap();
        let data = query.paginate(&self.db, self.config.frontend.page_size.try_into().unwrap());
        let mut items = vec![];
        for ex in data
            .fetch_page((input.search.page.unwrap() - 1).try_into().unwrap())
            .await?
        {
            let gql_repr = ex.graphql_repr(&self.file_storage_service).await;
            items.push(ExerciseSearchItem::from(gql_repr));
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
    async fn deploy_update_exercise_library_job(&self) -> Result<i32> {
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
            muscles: vec![],
            instructions: ex.attributes.instructions,
            internal_images: ex
                .attributes
                .images
                .into_iter()
                .map(StoredUrl::Url)
                .collect(),
            images: vec![],
        };
        if let Some(e) = Exercise::find()
            .filter(exercise::Column::Identifier.eq(&ex.identifier))
            .one(&self.db)
            .await?
        {
            tracing::trace!(
                "Updating existing exercise with identifier: {}",
                ex.identifier
            );
            let mut db_ex: exercise::ActiveModel = e.into();
            db_ex.attributes = ActiveValue::Set(attributes);
            db_ex.update(&self.db).await?;
        } else {
            let lot = match ex.attributes.category {
                ExerciseCategory::Stretching => ExerciseLot::Duration,
                ExerciseCategory::Plyometrics => ExerciseLot::Duration,
                ExerciseCategory::Cardio => ExerciseLot::DistanceAndDuration,
                ExerciseCategory::Powerlifting => ExerciseLot::RepsAndWeight,
                ExerciseCategory::Strength => ExerciseLot::RepsAndWeight,
                ExerciseCategory::OlympicWeightlifting => ExerciseLot::RepsAndWeight,
                ExerciseCategory::Strongman => ExerciseLot::RepsAndWeight,
            };
            let mut muscles = ex.attributes.primary_muscles;
            muscles.extend(ex.attributes.secondary_muscles);
            muscles.sort_unstable();
            let db_exercise = exercise::ActiveModel {
                name: ActiveValue::Set(ex.name),
                identifier: ActiveValue::Set(ex.identifier),
                muscles: ActiveValue::Set(ExerciseMuscles(muscles)),
                attributes: ActiveValue::Set(attributes),
                lot: ActiveValue::Set(lot),
                level: ActiveValue::Set(ex.attributes.level),
                force: ActiveValue::Set(ex.attributes.force),
                equipment: ActiveValue::Set(ex.attributes.equipment),
                mechanic: ActiveValue::Set(ex.attributes.mechanic),
                ..Default::default()
            };
            let created_exercise = db_exercise.insert(&self.db).await?;
            tracing::trace!("Created new exercise with id: {}", created_exercise.id);
        }
        Ok(())
    }

    pub async fn export_measurements(&self, user_id: i32) -> Result<Vec<user_measurement::Model>> {
        self.user_measurements_list(
            user_id,
            UserMeasurementsListInput {
                start_time: None,
                end_time: None,
            },
        )
        .await
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
    async fn create_user_workout(&self, user_id: i32, input: UserWorkoutInput) -> Result<String> {
        let user = partial_user_by_id::<UserWithOnlyPreferences>(&self.db, user_id).await?;
        let sf = Sonyflake::new().unwrap();
        let id = sf.next_id().unwrap().to_string();
        tracing::trace!("Creating new workout with id: {}", id);
        let identifier = input
            .calculate_and_commit(user_id, &self.db, id, user.preferences.fitness.exercises)
            .await?;
        Ok(identifier)
    }
}
