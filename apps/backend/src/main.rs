use std::{
    env,
    io::{Error as IoError, ErrorKind as IoErrorKind},
    net::SocketAddr,
    str::FromStr,
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::Result;
use apalis::{
    cron::{CronStream, Schedule},
    layers::{
        Extension as ApalisExtension, RateLimitLayer as ApalisRateLimitLayer,
        TraceLayer as ApalisTraceLayer,
    },
    prelude::{timer::TokioTimer as SleepTimer, Job as ApalisJob, *},
    sqlite::SqliteStorage,
};
use async_graphql::http::GraphiQLSource;
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use aws_sdk_s3::config::Region;
use axum::{
    body::{boxed, Full},
    extract::Multipart,
    http::{header, HeaderMap, Method, StatusCode, Uri},
    response::{Html, IntoResponse, Response},
    routing::{get, post, Router},
    Extension, Json, Server,
};
use config::AppConfig;
use dotenvy::dotenv;
use http::header::AUTHORIZATION;
use misc::resolver::COOKIE_NAME;
use rust_embed::RustEmbed;
use scdb::Store;
use sea_orm::{Database, DatabaseConnection};
use sea_orm_migration::MigratorTrait;
use serde_json::json;
use sqlx::SqlitePool;
use tokio::try_join;
use tower_cookies::{CookieManagerLayer, Cookies};
use tower_http::{
    catch_panic::CatchPanicLayer as TowerCatchPanicLayer, cors::CorsLayer as TowerCorsLayer,
    trace::TraceLayer as TowerTraceLayer,
};
use uuid::Uuid;

use crate::{
    background::{
        after_media_seen_job, general_media_cleanup_jobs, general_user_cleanup, import_media,
        recalculate_user_summary_job, update_metadata_job, user_created_job,
    },
    config::get_app_config,
    graphql::{get_schema, GraphqlSchema, PROJECT_NAME},
    migrator::Migrator,
    utils::create_app_services,
};

mod audio_books;
mod background;
mod books;
mod config;
mod entities;
mod graphql;
mod importer;
mod media;
mod migrator;
mod misc;
mod movies;
mod podcasts;
mod shows;
mod traits;
mod utils;
mod video_games;

pub static VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug)]
pub struct GqlCtx {
    auth_token: Option<String>,
}

async fn graphql_handler(
    schema: Extension<GraphqlSchema>,
    cookies: Cookies,
    headers: HeaderMap,
    req: GraphQLRequest,
) -> GraphQLResponse {
    let mut req = req.0;
    let mut ctx = GqlCtx { auth_token: None };
    if let Some(c) = cookies.get(COOKIE_NAME) {
        ctx.auth_token = Some(c.value().to_owned());
    } else if let Some(h) = headers.get(AUTHORIZATION) {
        ctx.auth_token = h.to_str().map(|e| e.replace("Bearer ", "")).ok();
    }
    req = req.data(ctx);
    schema.execute(req).await.into()
}

async fn graphql_playground() -> impl IntoResponse {
    Html(GraphiQLSource::build().endpoint("/graphql").finish())
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    tracing::info!("Running version {}", VERSION);

    dotenv().ok();
    let config = get_app_config()?;

    let mut aws_conf = aws_sdk_s3::Config::builder()
        .region(Region::new(config.file_storage.s3_region.clone()))
        .force_path_style(true);
    if !config.file_storage.s3_url.is_empty() {
        aws_conf = aws_conf.endpoint_url(&config.file_storage.s3_url);
    }
    if !config.file_storage.s3_access_key_id.is_empty()
        && !config.file_storage.s3_secret_access_key.is_empty()
    {
        aws_conf = aws_conf.credentials_provider(aws_sdk_s3::config::Credentials::new(
            &config.file_storage.s3_access_key_id,
            &config.file_storage.s3_secret_access_key,
            None,
            None,
            PROJECT_NAME,
        ));
    }
    let aws_conf = aws_conf.build();
    let s3_client = aws_sdk_s3::Client::from_conf(aws_conf);

    let db = Database::connect(&config.database.url)
        .await
        .expect("Database connection failed");
    let scdb = Arc::new(Mutex::new(
        Store::new(&config.database.scdb_url, None, None, None, None, false).unwrap(),
    ));

    let selected_database = match db {
        DatabaseConnection::SqlxSqlitePoolConnection(_) => "SQLite",
        DatabaseConnection::SqlxMySqlPoolConnection(_) => "MySQL",
        DatabaseConnection::SqlxPostgresPoolConnection(_) => "PostgreSQL",
        _ => "Unrecognized",
    };
    tracing::info!("Using database backend: {selected_database:?}");

    Migrator::up(&db, None).await.unwrap();

    let pool = SqlitePool::connect(&config.scheduler.database_url).await?;

    let import_media_storage = create_storage(pool.clone()).await;
    let user_created_job_storage = create_storage(pool.clone()).await;
    let after_media_seen_job_storage = create_storage(pool.clone()).await;
    let recalculate_user_summary_job_storage = create_storage(pool.clone()).await;
    let update_metadata_job_storage = create_storage(pool.clone()).await;

    let app_services = create_app_services(
        db.clone(),
        scdb.clone(),
        s3_client.clone(),
        &config,
        &import_media_storage,
        &user_created_job_storage,
        &after_media_seen_job_storage,
        &update_metadata_job_storage,
        &recalculate_user_summary_job_storage,
    )
    .await;
    let schema = get_schema(&app_services, db.clone(), scdb.clone(), &config).await;

    let cors = TowerCorsLayer::new()
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::ACCEPT, header::CONTENT_TYPE])
        .allow_origin(
            config
                .web
                .cors_origins
                .iter()
                .map(|f| f.parse().unwrap())
                .collect::<Vec<_>>(),
        )
        .allow_credentials(true);

    let app = Router::new()
        .route("/config", get(config_handler))
        .route("/upload", post(upload_handler))
        .route("/graphql", get(graphql_playground).post(graphql_handler))
        .layer(Extension(schema))
        .layer(Extension(config.clone()))
        .layer(Extension(s3_client.clone()))
        .layer(TowerTraceLayer::new_for_http())
        .layer(TowerCatchPanicLayer::new())
        .layer(CookieManagerLayer::new())
        .layer(cors)
        .fallback(static_handler);

    let port = env::var("PORT")
        .unwrap_or_else(|_| "8000".to_owned())
        .parse()
        .unwrap();
    let addr = SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 0], port));
    tracing::info!("Listening on {}", addr);

    let rate_limit_num = config.scheduler.rate_limit_num.try_into().unwrap();

    let importer_service_1 = app_services.importer_service.clone();
    let importer_service_2 = app_services.importer_service.clone();
    let media_service_1 = app_services.media_service.clone();
    let misc_service_1 = app_services.misc_service.clone();
    let misc_service_2 = app_services.misc_service.clone();
    let misc_service_3 = app_services.misc_service.clone();
    let misc_service_4 = app_services.misc_service.clone();

    let monitor = async {
        let mn = Monitor::new()
            // cron jobs
            .register_with_count(1, move |c| {
                WorkerBuilder::new(format!("general_user_cleanup-{c}"))
                    .stream(
                        CronStream::new(
                            Schedule::from_str(&format!(
                                "0 0 */{} ? * *",
                                config.scheduler.user_cleanup_every
                            ))
                            .unwrap(),
                        )
                        .timer(SleepTimer)
                        .to_stream(),
                    )
                    .layer(ApalisTraceLayer::new())
                    .layer(ApalisExtension(app_services.media_service.clone()))
                    .layer(ApalisExtension(misc_service_1.clone()))
                    .build_fn(general_user_cleanup)
            })
            .register_with_count(1, move |c| {
                WorkerBuilder::new(format!("general_media_cleanup_job-{c}"))
                    .stream(
                        // every day
                        CronStream::new(Schedule::from_str("0 0 0 * * *").unwrap())
                            .timer(SleepTimer)
                            .to_stream(),
                    )
                    .layer(ApalisTraceLayer::new())
                    .layer(ApalisExtension(importer_service_2.clone()))
                    .layer(ApalisExtension(media_service_1.clone()))
                    .build_fn(general_media_cleanup_jobs)
            })
            // application jobs
            .register_with_count(1, move |c| {
                WorkerBuilder::new(format!("import_media-{c}"))
                    .layer(ApalisTraceLayer::new())
                    .layer(ApalisExtension(importer_service_1.clone()))
                    .layer(ApalisExtension(config.clone()))
                    .with_storage(import_media_storage.clone())
                    .build_fn(import_media)
            })
            .register_with_count(1, move |c| {
                WorkerBuilder::new(format!("user_created_job-{c}"))
                    .layer(ApalisTraceLayer::new())
                    .layer(ApalisExtension(misc_service_2.clone()))
                    .with_storage(user_created_job_storage.clone())
                    .build_fn(user_created_job)
            })
            .register_with_count(1, move |c| {
                WorkerBuilder::new(format!("after_media_seen_job-{c}"))
                    .layer(ApalisTraceLayer::new())
                    .layer(ApalisExtension(app_services.misc_service.clone()))
                    .with_storage(after_media_seen_job_storage.clone())
                    .build_fn(after_media_seen_job)
            })
            .register_with_count(1, move |c| {
                WorkerBuilder::new(format!("recalculate_user_summary_job-{c}"))
                    .layer(ApalisTraceLayer::new())
                    .layer(ApalisExtension(misc_service_3.clone()))
                    .with_storage(recalculate_user_summary_job_storage.clone())
                    .build_fn(recalculate_user_summary_job)
            })
            .register_with_count(1, move |c| {
                WorkerBuilder::new(format!("update_metadata_job-{c}"))
                    .layer(ApalisTraceLayer::new())
                    .layer(ApalisRateLimitLayer::new(
                        rate_limit_num,
                        Duration::new(5, 0),
                    ))
                    .layer(ApalisExtension(misc_service_4.clone()))
                    .with_storage(update_metadata_job_storage.clone())
                    .build_fn(update_metadata_job)
            })
            .run()
            .await;
        Ok(mn)
    };

    let http = async {
        Server::bind(&addr)
            .serve(app.into_make_service())
            .await
            .map_err(|e| IoError::new(IoErrorKind::Interrupted, e))
    };

    let _res = try_join!(monitor, http).expect("Could not start services");

    Ok(())
}

static INDEX_HTML: &str = "index.html";

#[derive(RustEmbed)]
#[folder = "../frontend/out/"]
struct Assets;

async fn static_handler(uri: Uri) -> impl IntoResponse {
    let mut path = uri.path().trim_start_matches('/').to_owned();

    if path.is_empty() || path == INDEX_HTML {
        return index_html().await;
    }

    if !path.contains('.') {
        path.push_str(".html");
    }

    match Assets::get(&path) {
        Some(content) => {
            let body = boxed(Full::from(content.data));
            let mime = mime_guess::from_path(path).first_or_octet_stream();

            Response::builder()
                .header(header::CONTENT_TYPE, mime.as_ref())
                .body(body)
                .unwrap()
        }
        None => not_found().await,
    }
}

async fn index_html() -> Response {
    match Assets::get(INDEX_HTML) {
        Some(content) => {
            let body = boxed(Full::from(content.data));
            Response::builder()
                .header(header::CONTENT_TYPE, "text/html")
                .body(body)
                .unwrap()
        }
        None => not_found().await,
    }
}

async fn not_found() -> Response {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(boxed(Full::from("404")))
        .unwrap()
}

async fn config_handler(Extension(config): Extension<AppConfig>) -> impl IntoResponse {
    Json(config.masked_value())
}

async fn upload_handler(
    Extension(config): Extension<AppConfig>,
    Extension(s3_client): Extension<aws_sdk_s3::Client>,
    mut files: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let mut res = vec![];
    while let Some(file) = files.next_field().await.unwrap() {
        let name = file
            .file_name()
            .map(String::from)
            .unwrap_or_else(|| "file.png".to_string());
        let data = file.bytes().await.unwrap();
        let key = format!("uploads/{}-{}", Uuid::new_v4(), name);
        let _resp = s3_client
            .put_object()
            .bucket(&config.file_storage.s3_bucket_name)
            .key(&key)
            .body(data.into())
            .send()
            .await
            .map_err(|err| {
                tracing::error!("{:?}", err);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"err": "an error occured during file upload"})),
                )
            })?;
        res.push(key);
    }
    Ok(Json(json!(res)))
}

async fn create_storage<T: ApalisJob>(pool: SqlitePool) -> SqliteStorage<T> {
    let st = SqliteStorage::new(pool);
    st.setup().await.unwrap();
    st
}
