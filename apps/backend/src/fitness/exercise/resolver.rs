use std::sync::Arc;

use apalis::{prelude::Storage, sqlite::SqliteStorage};
use async_graphql::{Context, Error, InputObject, Object, Result};
use sea_orm::{
    prelude::DateTimeUtc, ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection,
    EntityTrait, ModelTrait, PaginatorTrait, QueryFilter, QueryOrder, QueryTrait,
};
use sea_query::{Alias, Condition, Expr, Func};
use serde::{Deserialize, Serialize};

use crate::{
    background::UpdateExerciseJob,
    entities::{
        exercise,
        prelude::{Exercise, UserMeasurement},
        user_measurement,
    },
    models::{
        fitness::{Exercise as GithubExercise, ExerciseAttributes},
        SearchResults,
    },
    traits::AuthProvider,
    utils::{get_case_insensitive_like_query, MemoryDatabase, PAGE_LIMIT},
};

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct ExercisesListInput {
    pub page: i32,
    pub query: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct UserMeasurementsListInput {
    pub start_time: Option<DateTimeUtc>,
    pub end_time: Option<DateTimeUtc>,
}

#[derive(Default)]
pub struct ExerciseQuery;

#[Object]
impl ExerciseQuery {
    /// Get a paginated list of exercises in the database.
    async fn exercises_list(
        &self,
        gql_ctx: &Context<'_>,
        input: ExercisesListInput,
    ) -> Result<SearchResults<exercise::Model>> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        service.exercises_list(input).await
    }

    /// Get information about an exercise.
    async fn exercise(&self, gql_ctx: &Context<'_>, exercise_id: i32) -> Result<exercise::Model> {
        let service = gql_ctx.data_unchecked::<Arc<ExerciseService>>();
        service.exercise(exercise_id).await
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
}

pub struct ExerciseService {
    db: DatabaseConnection,
    json_url: String,
    auth_db: MemoryDatabase,
    image_prefix_url: String,
    update_exercise: SqliteStorage<UpdateExerciseJob>,
}

impl AuthProvider for ExerciseService {
    fn get_auth_db(&self) -> &MemoryDatabase {
        &self.auth_db
    }
}

impl ExerciseService {
    pub fn new(
        db: &DatabaseConnection,
        auth_db: MemoryDatabase,
        update_exercise: &SqliteStorage<UpdateExerciseJob>,
        json_url: String,
        image_prefix_url: String,
    ) -> Self {
        Self {
            db: db.clone(),
            auth_db,
            update_exercise: update_exercise.clone(),
            json_url,
            image_prefix_url,
        }
    }
}

impl ExerciseService {
    async fn get_all_exercises_from_dataset(&self) -> Result<Vec<GithubExercise>> {
        let data: Vec<GithubExercise> = surf::get(&self.json_url)
            .send()
            .await
            .unwrap()
            .body_json()
            .await
            .unwrap();
        Ok(data
            .into_iter()
            .map(|e| GithubExercise {
                attributes: ExerciseAttributes {
                    images: e
                        .attributes
                        .images
                        .into_iter()
                        .map(|i| format!("{}/{}", self.image_prefix_url, i))
                        .collect(),
                    ..e.attributes
                },
                ..e
            })
            .collect())
    }

    async fn exercise(&self, exercise_id: i32) -> Result<exercise::Model> {
        let maybe_exercise = Exercise::find_by_id(exercise_id).one(&self.db).await?;
        match maybe_exercise {
            None => Err(Error::new("Exercise with the given ID could not be found.")),
            Some(e) => Ok(e),
        }
    }

    async fn exercises_list(
        &self,
        input: ExercisesListInput,
    ) -> Result<SearchResults<exercise::Model>> {
        let query = Exercise::find()
            .apply_if(input.query, |query, v| {
                query.filter(
                    Condition::any()
                        .add(get_case_insensitive_like_query(
                            Func::lower(Expr::col(exercise::Column::Name)),
                            &v,
                        ))
                        .add(get_case_insensitive_like_query(
                            Func::lower(Func::cast_as(
                                Expr::col(exercise::Column::Attributes),
                                Alias::new("text"),
                            )),
                            &v,
                        )),
                )
            })
            .order_by_asc(exercise::Column::Name);
        let total = query.clone().count(&self.db).await?;
        let total: i32 = total.try_into().unwrap();
        let data = query.paginate(&self.db, PAGE_LIMIT.try_into().unwrap());
        let mut items = vec![];
        for ex in data
            .fetch_page((input.page - 1).try_into().unwrap())
            .await?
        {
            items.push(ex);
        }
        let next_page = if total - ((input.page) * PAGE_LIMIT) > 0 {
            Some(input.page + 1)
        } else {
            None
        };
        Ok(SearchResults {
            total,
            items,
            next_page,
        })
    }

    async fn deploy_update_exercise_library_job(&self) -> Result<i32> {
        let mut storage = self.update_exercise.clone();
        let exercises = self.get_all_exercises_from_dataset().await?;
        let mut job_ids = vec![];
        for exercise in exercises {
            let job = storage.push(UpdateExerciseJob { exercise }).await?;
            job_ids.push(job.to_string());
        }
        Ok(job_ids.len().try_into().unwrap())
    }

    pub async fn update_exercise(&self, ex: GithubExercise) -> Result<()> {
        if Exercise::find()
            .filter(exercise::Column::Identifier.eq(&ex.identifier))
            .one(&self.db)
            .await?
            .is_none()
        {
            let db_exercise = exercise::ActiveModel {
                name: ActiveValue::Set(ex.name),
                identifier: ActiveValue::Set(ex.identifier),
                attributes: ActiveValue::Set(ex.attributes),
                ..Default::default()
            };
            db_exercise.insert(&self.db).await?;
        }
        Ok(())
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
}
