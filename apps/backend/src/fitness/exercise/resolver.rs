use std::sync::Arc;

use apalis::{prelude::Storage, sqlite::SqliteStorage};
use async_graphql::{Context, InputObject, Object, Result};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait,
    QueryFilter, QueryOrder, QueryTrait,
};
use sea_query::{Condition, Expr, Func};
use serde::{Deserialize, Serialize};

use crate::{
    background::UpdateExerciseJob,
    entities::{exercise, prelude::Exercise},
    models::{
        fitness::{Exercise as GithubExercise, ExerciseAttributes},
        SearchResults,
    },
    utils::{get_case_insensitive_like_query, PAGE_LIMIT},
};

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct ExercisesListInput {
    pub page: i32,
    pub query: Option<String>,
}

#[derive(Default)]
pub struct ExerciseQuery;

#[Object]
impl ExerciseQuery {
    /// Get all the exercises in the database
    async fn exercises_list(
        &self,
        gql_ctx: &Context<'_>,
        input: ExercisesListInput,
    ) -> Result<SearchResults<exercise::Model>> {
        gql_ctx
            .data_unchecked::<Arc<ExerciseService>>()
            .exercises_list(input)
            .await
    }
}

#[derive(Default)]
pub struct ExerciseMutation;

#[Object]
impl ExerciseMutation {
    /// Deploy a job to download update the exercise library
    async fn deploy_update_exercise_library_job(&self, gql_ctx: &Context<'_>) -> Result<i32> {
        gql_ctx
            .data_unchecked::<Arc<ExerciseService>>()
            .deploy_update_exercise_library_job()
            .await
    }
}

#[derive(Debug)]
pub struct ExerciseService {
    db: DatabaseConnection,
    json_url: String,
    image_prefix_url: String,
    update_exercise: SqliteStorage<UpdateExerciseJob>,
}

impl ExerciseService {
    pub fn new(
        db: &DatabaseConnection,
        update_exercise: &SqliteStorage<UpdateExerciseJob>,
        json_url: String,
        image_prefix_url: String,
    ) -> Self {
        Self {
            db: db.clone(),
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

    async fn exercises_list(
        &self,
        input: ExercisesListInput,
    ) -> Result<SearchResults<exercise::Model>> {
        let query = Exercise::find()
            .apply_if(input.query, |query, v| {
                query.filter(Condition::all().add(get_case_insensitive_like_query(
                    Func::lower(Expr::col(exercise::Column::Name)),
                    &v,
                )))
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
}
