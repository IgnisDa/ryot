use std::{
    env,
    fs::{self, create_dir_all},
    io::{Error as IoError, ErrorKind as IoErrorKind},
    net::SocketAddr,
    path::PathBuf,
    str::FromStr,
    sync::Arc,
    time::Duration,
};

use anyhow::{bail, Result};
use apalis::{
    cron::{CronStream, Schedule},
    layers::{
        Extension as ApalisExtension, RateLimitLayer as ApalisRateLimitLayer,
        TraceLayer as ApalisTraceLayer,
    },
    prelude::{timer::TokioTimer as SleepTimer, Job as ApalisJob, *},
    sqlite::SqliteStorage,
};
use aws_sdk_s3::config::Region;
use axum::{
    extract::DefaultBodyLimit,
    http::{header, Method},
    routing::{get, post, Router},
    Extension, Server,
};
use itertools::Itertools;
use sea_orm::{ConnectOptions, Database, DatabaseConnection};
use sea_orm_migration::MigratorTrait;
use sqlx::{pool::PoolOptions, SqlitePool};
use tokio::try_join;
use tower_http::{
    catch_panic::CatchPanicLayer as TowerCatchPanicLayer, cors::CorsLayer as TowerCorsLayer,
    trace::TraceLayer as TowerTraceLayer,
};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{fmt, layer::SubscriberExt};

use crate::{
    background::{media_jobs, perform_application_job, user_jobs, yank_integrations_data},
    config::load_app_config,
    config::AppConfig,
    graphql::get_schema,
    migrator::Migrator,
    routes::{
        config_handler, graphql_handler, graphql_playground, integration_webhook, json_export,
        static_handler, upload_file,
    },
    utils::{create_app_services, BASE_DIR, PROJECT_NAME, VERSION},
};

mod background;
mod config;
mod entities;
mod file_storage;
mod fitness;
mod graphql;
mod importer;
mod integrations;
mod jwt;
mod migrator;
mod miscellaneous;
mod models;
mod notification;
mod providers;
mod routes;
mod traits;
mod users;
mod utils;

#[tokio::main]
async fn main() -> Result<()> {
    #[cfg(debug_assertions)]
    dotenvy::dotenv().ok();

    if env::var("RUST_LOG").is_err() {
        env::set_var("RUST_LOG", "ryot=info,sea_orm=info");
    }
    let _guard = init_tracing();

    tracing::info!("Running version {}", VERSION);

    let config = Arc::new(load_app_config()?);
    let cors_origins = config
        .server
        .cors_origins
        .iter()
        .map(|f| f.parse().unwrap())
        .collect_vec();
    let rate_limit_num = config.scheduler.rate_limit_num;
    let user_cleanup_every = config.scheduler.user_cleanup_every;
    let pull_every = config.integration.pull_every;
    let max_file_size = config.server.max_file_size;
    let new_background_job_check_seconds = config.server.application_job_check_seconds;
    fs::write(
        &config.server.config_dump_path,
        serde_json::to_string_pretty(&config)?,
    )?;

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

    let opt = ConnectOptions::new(config.database.url.clone())
        .min_connections(5)
        .max_connections(10)
        .connect_timeout(Duration::from_secs(10))
        .acquire_timeout(Duration::from_secs(10))
        .to_owned();
    let db = Database::connect(opt)
        .await
        .expect("Database connection failed");

    let selected_database = match db {
        DatabaseConnection::SqlxSqlitePoolConnection(_) => "SQLite",
        DatabaseConnection::SqlxMySqlPoolConnection(_) => "MySQL",
        DatabaseConnection::SqlxPostgresPoolConnection(_) => "PostgreSQL",
        _ => "Unrecognized",
    };
    tracing::info!("Using database backend: {selected_database:?}");

    Migrator::up(&db, None).await.unwrap();

    match env::args().nth(1) {
        None => {}
        Some(cmd) => {
            if cmd == "migrate" {
                return Ok(());
            } else {
                bail!("Command {:#?} is not supported.", cmd)
            }
        }
    }

    let pool = PoolOptions::new()
        .max_lifetime(None)
        .idle_timeout(None)
        .connect(&config.scheduler.database_url)
        .await?;

    let perform_application_job_storage = create_storage(pool.clone()).await;

    let app_services = create_app_services(
        db.clone(),
        s3_client,
        config,
        &perform_application_job_storage,
    )
    .await;

    if cfg!(debug_assertions) {
        use specta::export;

        // FIXME: Once https://github.com/rust-lang/cargo/issues/3946 is resolved
        let base_dir = PathBuf::from(BASE_DIR)
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("docs")
            .join("includes");
        let mut generator = schematic::schema::SchemaGenerator::default();
        generator.add::<AppConfig>();
        generator
            .generate(
                base_dir.join("backend-config-schema.ts"),
                schematic::schema::typescript::TypeScriptRenderer::default(),
            )
            .unwrap();
        let export_path = base_dir.join("export-schema.ts");
        if !export_path.exists() {
            export::ts(export_path.to_str().unwrap()).unwrap();
        }
    }

    let schema = get_schema(&app_services).await;

    let cors = TowerCorsLayer::new()
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::ACCEPT, header::CONTENT_TYPE])
        .allow_origin(cors_origins)
        .allow_credentials(true);

    let webhook_routes = Router::new().route(
        "/integrations/:integration/:user_hash_id",
        post(integration_webhook),
    );

    let app_routes = Router::new()
        .route("/config", get(config_handler))
        .route("/graphql", get(graphql_playground).post(graphql_handler))
        .nest("/webhooks", webhook_routes)
        .route("/export/:export_type", get(json_export))
        .route("/upload", post(upload_file))
        .fallback(static_handler)
        .layer(Extension(app_services.config.clone()))
        .layer(Extension(app_services.media_service.clone()))
        .layer(Extension(app_services.exercise_service.clone()))
        .layer(Extension(schema))
        .layer(TowerTraceLayer::new_for_http())
        .layer(TowerCatchPanicLayer::new())
        .layer(DefaultBodyLimit::max(1024 * 1024 * max_file_size))
        .layer(cors);

    let port = env::var("PORT")
        .unwrap_or_else(|_| "8000".to_owned())
        .parse()
        .unwrap();
    let addr = SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 0], port));
    tracing::info!("Listening on {}", addr);

    let importer_service_1 = app_services.importer_service.clone();
    let importer_service_2 = app_services.importer_service.clone();
    let media_service_1 = app_services.media_service.clone();
    let media_service_2 = app_services.media_service.clone();
    let media_service_3 = app_services.media_service.clone();
    let media_service_4 = app_services.media_service.clone();
    let exercise_service_1 = app_services.exercise_service.clone();

    let monitor = async {
        let mn = Monitor::new()
            // cron jobs
            .register_with_count(1, move |c| {
                WorkerBuilder::new(format!("general_user_cleanup-{c}"))
                    .stream(
                        CronStream::new(
                            Schedule::from_str(&format!("0 0 */{} ? * *", user_cleanup_every))
                                .unwrap(),
                        )
                        .timer(SleepTimer)
                        .to_stream(),
                    )
                    .layer(ApalisTraceLayer::new())
                    .layer(ApalisExtension(media_service_1.clone()))
                    .build_fn(user_jobs)
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
                    .layer(ApalisExtension(media_service_2.clone()))
                    .build_fn(media_jobs)
            })
            .register_with_count(1, move |c| {
                WorkerBuilder::new(format!("yank_integrations_data-{c}"))
                    .stream(
                        CronStream::new(
                            Schedule::from_str(&format!("0 0 */{} ? * *", pull_every)).unwrap(),
                        )
                        .timer(SleepTimer)
                        .to_stream(),
                    )
                    .layer(ApalisTraceLayer::new())
                    .layer(ApalisExtension(media_service_3.clone()))
                    .build_fn(yank_integrations_data)
            })
            // application jobs
            .register_with_count(3, move |c| {
                WorkerBuilder::new(format!("perform_application_job-{c}"))
                    .layer(ApalisTraceLayer::new())
                    .layer(ApalisRateLimitLayer::new(
                        rate_limit_num,
                        Duration::new(5, 0),
                    ))
                    .layer(ApalisExtension(importer_service_1.clone()))
                    .layer(ApalisExtension(media_service_4.clone()))
                    .layer(ApalisExtension(exercise_service_1.clone()))
                    .with_storage_config(perform_application_job_storage.clone(), |cfg| {
                        cfg.fetch_interval(Duration::from_secs(new_background_job_check_seconds))
                    })
                    .build_fn(perform_application_job)
            })
            .run()
            .await;
        Ok(mn)
    };

    let http = async {
        Server::bind(&addr)
            .serve(app_routes.into_make_service())
            .await
            .map_err(|e| IoError::new(IoErrorKind::Interrupted, e))
    };

    let _res = try_join!(monitor, http).expect("Could not start services");

    Ok(())
}

async fn create_storage<T: ApalisJob>(pool: SqlitePool) -> SqliteStorage<T> {
    let st = SqliteStorage::new(pool);
    st.setup().await.unwrap();
    st
}

fn init_tracing() -> Result<WorkerGuard> {
    let tmp_dir = PathBuf::new().join("tmp");
    create_dir_all(&tmp_dir)?;
    let path = tmp_dir.join(format!("{}.log", PROJECT_NAME));
    let file_appender = tracing_appender::rolling::daily(".", path);
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    tracing::subscriber::set_global_default(
        fmt::Subscriber::builder()
            .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
            .finish()
            // add additional writers
            .with(
                fmt::Layer::default()
                    .with_writer(non_blocking)
                    .with_ansi(false),
            ),
    )
    .expect("Unable to set global tracing subscriber");
    Ok(guard)
}
