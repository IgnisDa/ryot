use std::{
    fs::File,
    io::Read,
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use apalis::sqlite::SqliteStorage;
use async_graphql::{Error, InputObject, Result, SimpleObject};
use chrono::{NaiveDate, Utc};
use darkbird::{
    document::{Document, FullText, Indexer, MaterializedView, Range, RangeField, Tags},
    Storage,
};
use http_types::headers::HeaderName;
use sea_orm::{
    prelude::DateTimeUtc, ActiveModelTrait, ActiveValue, ConnectionTrait, DatabaseConnection,
};
use sea_query::{BinOper, Expr, Func, SimpleExpr};
use serde::{
    de::{self, DeserializeOwned},
    Deserialize, Serialize,
};
use surf::{
    http::headers::{ToHeaderValues, USER_AGENT},
    Client, Config, Url,
};
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
    importer::ImporterService,
    miscellaneous::resolver::MiscellaneousService,
};

pub type MemoryDatabase = Arc<Storage<String, MemoryAuthData>>;

pub static VERSION: &str = env!("CARGO_PKG_VERSION");
pub static BASE_DIR: &str = env!("CARGO_MANIFEST_DIR");
pub const PAGE_LIMIT: i32 = 20;
pub const COOKIE_NAME: &str = "auth";
pub const AUTHOR: &str = "ignisda";
pub const PROJECT_NAME: &str = env!("CARGO_PKG_NAME");
pub const REPOSITORY_LINK: &str = "https://github.com/ignisda/ryot";
pub const USER_AGENT_STR: &str = const_str::concat!(AUTHOR, "/", PROJECT_NAME);

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
    auth_db: MemoryDatabase,
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
        config.file_storage.s3_bucket_name.clone(),
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

pub async fn user_id_from_token(token: String, auth_db: &MemoryDatabase) -> Result<i32> {
    let found_token = auth_db.lookup(&token);
    match found_token {
        Some(t) => {
            let mut val = t.value().clone();
            // DEV: since `t` is a reference to the actual data, we can not
            // update it before dropping
            drop(t);
            let return_value = val.user_id;
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

pub fn get_base_http_client(
    url: &str,
    headers: Vec<(impl Into<HeaderName>, impl ToHeaderValues)>,
) -> Client {
    let mut config = Config::new()
        .add_header(USER_AGENT, USER_AGENT_STR)
        .unwrap();
    for (header, value) in headers.into_iter() {
        config = config.add_header(header, value).unwrap();
    }
    config
        .set_base_url(Url::parse(url).unwrap())
        .try_into()
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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MemoryAuthData {
    pub user_id: i32,
    pub last_used_on: DateTimeUtc,
}

impl Document for MemoryAuthData {}

impl Indexer for MemoryAuthData {
    fn extract(&self) -> Vec<String> {
        vec![]
    }
}

impl Tags for MemoryAuthData {
    fn get_tags(&self) -> Vec<String> {
        vec![]
    }
}

impl Range for MemoryAuthData {
    fn get_fields(&self) -> Vec<RangeField> {
        vec![]
    }
}

impl MaterializedView for MemoryAuthData {
    fn filter(&self) -> Option<String> {
        None
    }
}

impl FullText for MemoryAuthData {
    fn get_content(&self) -> Option<String> {
        None
    }
}
