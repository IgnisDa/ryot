use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use apalis::sqlite::SqliteStorage;
use async_graphql::{Error, Result};
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use darkbird::{
    document::{Document, FullText, Indexer, MaterializedView, Range, RangeField, Tags},
    Storage,
};
use http_types::headers::HeaderName;
use sea_orm::{
    prelude::DateTimeUtc, ActiveModelTrait, ActiveValue, ColumnTrait, ConnectionTrait,
    DatabaseConnection, EntityTrait, QueryFilter,
};
use sea_query::{BinOper, Expr, Func, SimpleExpr};
use serde::{Deserialize, Serialize};
use surf::{
    http::headers::{ToHeaderValues, USER_AGENT},
    Client, Config, Url,
};

use crate::{
    background::{
        ImportMedia, RecalculateUserSummaryJob, UpdateExerciseJob, UpdateMetadataJob,
        UserCreatedJob,
    },
    config::AppConfig,
    entities::{prelude::UserToMetadata, user_to_metadata},
    file_storage::FileStorageService,
    fitness::exercise::resolver::ExerciseService,
    importer::ImporterService,
    miscellaneous::resolver::MiscellaneousService,
};

pub type MemoryDatabase = Arc<Storage<String, MemoryAuthData>>;

pub static BASE_DIR: &str = env!("CARGO_MANIFEST_DIR");
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const PROJECT_NAME: &str = env!("CARGO_PKG_NAME");
pub const COOKIE_NAME: &str = "auth";
pub const AUTHOR: &str = "ignisda";
pub const AUTHOR_EMAIL: &str = "ignisda2001@gmail.com";
pub const USER_AGENT_STR: &str = const_str::concat!(
    AUTHOR,
    "/",
    PROJECT_NAME,
    "-v",
    VERSION,
    " (",
    AUTHOR_EMAIL,
    ")"
);
pub const AVATAR_URL: &str =
    "https://raw.githubusercontent.com/IgnisDa/ryot/main/apps/frontend/public/icon-512x512.png";

/// All the services that are used by the app
pub struct AppServices {
    pub config: Arc<AppConfig>,
    pub media_service: Arc<MiscellaneousService>,
    pub importer_service: Arc<ImporterService>,
    pub file_storage_service: Arc<FileStorageService>,
    pub exercise_service: Arc<ExerciseService>,
    pub auth_db: MemoryDatabase,
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
    update_metadata_job: &SqliteStorage<UpdateMetadataJob>,
    recalculate_user_summary_job: &SqliteStorage<RecalculateUserSummaryJob>,
) -> AppServices {
    let file_storage_service = Arc::new(FileStorageService::new(
        s3_client,
        config.file_storage.s3_bucket_name.clone(),
    ));
    let exercise_service = Arc::new(ExerciseService::new(
        &db,
        config.clone(),
        auth_db.clone(),
        update_exercise_job,
    ));

    let media_service = Arc::new(
        MiscellaneousService::new(
            &db,
            config.clone(),
            auth_db.clone(),
            file_storage_service.clone(),
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
        config,
        media_service,
        importer_service,
        file_storage_service,
        exercise_service,
        auth_db,
    }
}

pub async fn get_user_and_metadata_association<C>(
    user_id: &i32,
    metadata_id: &i32,
    db: &C,
) -> Option<user_to_metadata::Model>
where
    C: ConnectionTrait,
{
    UserToMetadata::find()
        .filter(user_to_metadata::Column::UserId.eq(user_id.to_owned()))
        .filter(user_to_metadata::Column::MetadataId.eq(metadata_id.to_owned()))
        .one(db)
        .await
        .ok()
        .flatten()
}

pub async fn associate_user_with_metadata<C>(
    user_id: &i32,
    metadata_id: &i32,
    db: &C,
) -> Result<user_to_metadata::Model>
where
    C: ConnectionTrait,
{
    let user_to_meta = get_user_and_metadata_association(user_id, metadata_id, db).await;
    Ok(match user_to_meta {
        None => {
            let user_to_meta = user_to_metadata::ActiveModel {
                user_id: ActiveValue::Set(*user_id),
                metadata_id: ActiveValue::Set(*metadata_id),
                ..Default::default()
            };
            user_to_meta.insert(db).await.unwrap()
        }
        Some(u) => u,
    })
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

pub fn convert_naive_to_utc(d: NaiveDate) -> DateTimeUtc {
    DateTime::from_utc(
        NaiveDateTime::new(d, NaiveTime::from_hms_opt(0, 0, 0).unwrap()),
        Utc,
    )
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
        Box::new(Func::lower(expr.into()).into()),
        BinOper::Like,
        Box::new(Func::lower(Expr::val(format!("%{}%", v))).into()),
    )
}

#[derive(Debug)]
pub struct GqlCtx {
    pub auth_token: Option<String>,
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
