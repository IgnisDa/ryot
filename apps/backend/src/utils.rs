use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use apalis::sqlite::SqliteStorage;
use async_graphql::{Error, Result};
use axum::{
    async_trait,
    extract::{FromRequestParts, TypedHeader},
    headers::{authorization::Bearer, Authorization},
    http::{request::Parts, StatusCode},
    Extension, RequestPartsExt,
};
use axum_extra::extract::cookie::CookieJar;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use http_types::headers::HeaderName;
use sea_orm::{
    prelude::DateTimeUtc, ActiveModelTrait, ActiveValue, ColumnTrait, ConnectionTrait,
    DatabaseConnection, EntityTrait, QueryFilter,
};
use sea_query::{BinOper, Expr, Func, SimpleExpr};
use surf::{
    http::headers::{ToHeaderValues, USER_AGENT},
    Client, Config, Url,
};

use crate::{
    background::ApplicationJob,
    config::AppConfig,
    entities::{
        prelude::{User, UserToMetadata},
        user, user_to_metadata,
    },
    file_storage::FileStorageService,
    fitness::exercise::resolver::ExerciseService,
    importer::ImporterService,
    jwt,
    miscellaneous::resolver::MiscellaneousService,
    models::StoredUrl,
};

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
}

#[allow(clippy::too_many_arguments)]
pub async fn create_app_services(
    db: DatabaseConnection,
    s3_client: aws_sdk_s3::Client,
    config: Arc<AppConfig>,
    perform_application_job: &SqliteStorage<ApplicationJob>,
) -> AppServices {
    let file_storage_service = Arc::new(FileStorageService::new(
        s3_client,
        config.file_storage.s3_bucket_name.clone(),
    ));
    let exercise_service = Arc::new(ExerciseService::new(
        &db,
        config.clone(),
        file_storage_service.clone(),
        perform_application_job,
    ));

    let media_service = Arc::new(
        MiscellaneousService::new(
            &db,
            config.clone(),
            file_storage_service.clone(),
            perform_application_job,
        )
        .await,
    );
    let importer_service = Arc::new(ImporterService::new(media_service.clone()));
    AppServices {
        config,
        media_service,
        importer_service,
        file_storage_service,
        exercise_service,
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

pub fn user_id_from_token(token: &str, jwt_secret: &str) -> Result<i32> {
    jwt::verify(token, jwt_secret)
        .map(|c| c.sub)
        .map_err(|e| Error::new(format!("Encountered error: {:?}", e)))
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

pub async fn get_stored_image(
    url: StoredUrl,
    files_storage_service: &Arc<FileStorageService>,
) -> String {
    match url {
        StoredUrl::Url(u) => u,
        StoredUrl::S3(u) => files_storage_service.get_presigned_url(u).await,
    }
}

pub async fn user_by_id(db: &DatabaseConnection, user_id: i32) -> Result<user::Model> {
    User::find_by_id(user_id)
        .one(db)
        .await
        .unwrap()
        .ok_or_else(|| Error::new("No user found"))
}

#[derive(Debug, Default)]
pub struct GqlCtx {
    pub auth_token: Option<String>,
    pub user_id: Option<i32>,
}

#[async_trait]
impl<S> FromRequestParts<S> for GqlCtx
where
    S: Send + Sync,
{
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let mut ctx = GqlCtx {
            ..Default::default()
        };
        let jar = parts.extract::<CookieJar>().await.unwrap();
        if let Some(c) = jar.get(COOKIE_NAME) {
            ctx.auth_token = Some(c.value().to_owned());
        } else if let Some(TypedHeader(Authorization(t))) =
            TypedHeader::<Authorization<Bearer>>::from_request_parts(parts, state)
                .await
                .ok()
        {
            ctx.auth_token = Some(t.token().to_owned());
        } else if let Some(h) = parts.headers.get("X-Auth-Token") {
            ctx.auth_token = h.to_str().map(String::from).ok();
        }
        if let Some(auth_token) = ctx.auth_token.as_ref() {
            let Extension(config) = parts.extract::<Extension<Arc<AppConfig>>>().await.unwrap();
            if let Ok(user_id) = user_id_from_token(auth_token, &config.users.jwt_secret) {
                ctx.user_id = Some(user_id);
            }
        }
        Ok(ctx)
    }
}
