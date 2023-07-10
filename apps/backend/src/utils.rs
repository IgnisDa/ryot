use std::fs::File;
use std::io::Read;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use apalis::sqlite::SqliteStorage;
use async_graphql::{Context, Error, InputObject, Result, SimpleObject};
use chrono::{NaiveDate, Utc};
use darkbird::Storage;
use sea_orm::{ActiveModelTrait, ActiveValue, ConnectionTrait, DatabaseConnection};
use sea_query::{BinOper, Expr, Func, SimpleExpr};
use serde::de::{self, DeserializeOwned};
use serde::{Deserialize, Serialize};
use surf::http::headers::USER_AGENT;
use surf::{Client, Config};
use tokio::task::JoinSet;

use crate::{
    background::{
        AfterMediaSeenJob, ImportMedia, RecalculateUserSummaryJob, UpdateExerciseJob,
        UpdateMetadataJob, UserCreatedJob,
    },
    config::AppConfig,
    entities::user_to_metadata,
    file_storage::FileStorageService,
    fitness::exercise::resolver::ExerciseService,
    graphql::USER_AGENT_STR,
    importer::ImporterService,
    miscellaneous::resolver::MiscellaneousService,
    GqlCtx, MemoryAuthData,
};

pub static PAGE_LIMIT: i32 = 20;
pub static COOKIE_NAME: &str = "auth";
pub type MemoryAuthDb = Arc<Storage<String, MemoryAuthData>>;

/// All the services that are used by the app
pub struct AppServices {
    pub media_service: Arc<MiscellaneousService>,
    pub importer_service: Arc<ImporterService>,
    pub file_storage_service: Arc<FileStorageService>,
    pub exercise_service: Arc<ExerciseService>,
}

#[allow(clippy::too_many_arguments)]
pub async fn create_app_services(
    db: DatabaseConnection,
    auth_db: MemoryAuthDb,
    s3_client: aws_sdk_s3::Client,
    config: Arc<AppConfig>,
    import_media_job: &SqliteStorage<ImportMedia>,
    user_created_job: &SqliteStorage<UserCreatedJob>,
    update_exercise_job: &SqliteStorage<UpdateExerciseJob>,
    after_media_seen_job: &SqliteStorage<AfterMediaSeenJob>,
    update_metadata_job: &SqliteStorage<UpdateMetadataJob>,
    recalculate_user_summary_job: &SqliteStorage<RecalculateUserSummaryJob>,
) -> AppServices {
    let file_storage_service = Arc::new(FileStorageService::new(
        s3_client,
        &config.file_storage.s3_bucket_name,
    ));
    let exercise_service = Arc::new(ExerciseService::new(
        &db,
        file_storage_service.clone(),
        config.exercise.db.json_url.clone(),
        config.exercise.db.images_prefix_url.clone(),
        update_exercise_job,
    ));

    let media_service = Arc::new(
        MiscellaneousService::new(
            &db,
            &auth_db,
            config,
            file_storage_service.clone(),
            after_media_seen_job,
            update_metadata_job,
            recalculate_user_summary_job,
            user_created_job,
        )
        .await,
    );
    let importer_service = Arc::new(ImporterService::new(
        &db,
        media_service.clone(),
        import_media_job,
    ));
    AppServices {
        media_service,
        importer_service,
        file_storage_service,
        exercise_service,
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, SimpleObject, InputObject)]
#[graphql(input_name = "NamedObjectInput")]
pub struct NamedObject {
    pub name: String,
}

#[derive(Serialize, Deserialize, Debug, InputObject)]
pub struct SearchInput {
    pub query: String,
    pub page: Option<i32>,
}

pub async fn associate_user_with_metadata<C>(user_id: &i32, metadata_id: &i32, db: &C) -> Result<()>
where
    C: ConnectionTrait,
{
    let user_to_meta = user_to_metadata::ActiveModel {
        user_id: ActiveValue::Set(*user_id),
        metadata_id: ActiveValue::Set(*metadata_id),
        ..Default::default()
    };
    user_to_meta.insert(db).await.ok();
    Ok(())
}

pub fn user_auth_token_from_ctx(ctx: &Context<'_>) -> Result<String> {
    let ctx = ctx.data_unchecked::<GqlCtx>();
    ctx.auth_token
        .clone()
        .ok_or_else(|| Error::new("The auth token is not present".to_owned()))
}

pub async fn user_id_from_ctx(ctx: &Context<'_>) -> Result<i32> {
    let auth_db = ctx.data_unchecked::<MemoryAuthDb>();
    let token = user_auth_token_from_ctx(ctx)?;
    user_id_from_token(token, auth_db).await
}

pub async fn user_id_from_token(token: String, auth_db: &MemoryAuthDb) -> Result<i32> {
    let found_token = auth_db.lookup(&token);
    match found_token {
        Some(t) => {
            let mut val = t.value().clone();
            drop(t); // since `t` is a references, we can not update it before dropping
            let return_value = val.user_id.clone();
            val.last_used_on = Utc::now();
            auth_db.insert(token, val).await.unwrap();
            Ok(return_value)
        }
        None => Err(Error::new("The auth token was incorrect")),
    }
}

pub fn convert_string_to_date(d: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()
}

pub fn convert_date_to_year(d: &str) -> Option<i32> {
    convert_string_to_date(d).map(|d| d.format("%Y").to_string().parse::<i32>().unwrap())
}

pub async fn get_data_parallelly_from_sources<'a, T, F, R>(
    iterate_over: &'a [T],
    client: &'a Client,
    get_url: F,
) -> Vec<R>
where
    F: Fn(&T) -> String,
    T: Send + Sync + de::DeserializeOwned + 'static,
    R: Send + Sync + de::DeserializeOwned + 'static,
{
    let mut set = JoinSet::new();
    for elm in iterate_over.iter() {
        let client = client.clone();
        let url = get_url(elm);
        set.spawn(async move {
            let mut rsp = client.get(url).await.unwrap();
            let single_element: R = rsp.body_json().await.unwrap();
            single_element
        });
    }
    let mut data = vec![];
    while let Some(Ok(result)) = set.join_next().await {
        data.push(result);
    }
    data
}

pub fn read_file_to_json<T: DeserializeOwned>(path: &PathBuf) -> Option<T> {
    let mut file = File::open(path).ok()?;
    let mut data = String::new();
    file.read_to_string(&mut data).unwrap();
    serde_json::from_str::<T>(&data).ok()
}

pub fn get_now_timestamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards")
        .as_millis()
}

pub fn get_base_http_client_config() -> Config {
    Config::new()
        .add_header(USER_AGENT, USER_AGENT_STR)
        .unwrap()
}

pub fn get_case_insensitive_like_query<E>(expr: E, v: &str) -> SimpleExpr
where
    E: Into<SimpleExpr>,
{
    SimpleExpr::Binary(
        Box::new(expr.into()),
        BinOper::Like,
        Box::new(Func::lower(Expr::val(format!("%{}%", v))).into()),
    )
}
