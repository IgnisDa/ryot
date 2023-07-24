use std::{
    env, fs,
    io::{Error as IoError, ErrorKind as IoErrorKind},
    net::SocketAddr,
    path::PathBuf,
    str::FromStr,
    sync::Arc,
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
use aws_sdk_s3::config::Region;
use axum::{
    http::{header, Method},
    routing::{get, post, Router},
    Extension, Server,
};
use darkbird::{Options, Storage, StorageType};
use itertools::Itertools;
use sea_orm::{ConnectOptions, Database, DatabaseConnection};
use sea_orm_migration::MigratorTrait;
use sqlx::SqlitePool;
use tokio::try_join;
use tower_cookies::CookieManagerLayer;
use tower_http::{
    catch_panic::CatchPanicLayer as TowerCatchPanicLayer, cors::CorsLayer as TowerCorsLayer,
    trace::TraceLayer as TowerTraceLayer,
};

use crate::{
    background::{
        general_media_cleanup_jobs, general_user_cleanup, import_media,
        recalculate_user_summary_job, update_exercise_job, update_metadata_job, user_created_job,
        yank_integrations_data,
    },
    config::get_app_config,
    config::AppConfig,
    graphql::get_schema,
    migrator::Migrator,
    routes::{
        config_handler, graphql_handler, graphql_playground, integration_webhook, json_export,
        static_handler, upload_handler,
    },
    utils::{create_app_services, MemoryAuthData, BASE_DIR, PROJECT_NAME, VERSION},
};

mod background;
mod config;
mod entities;
mod file_storage;
mod fitness;
mod graphql;
mod importer;
mod integrations;
mod migrator;
mod miscellaneous;
mod models;
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

    tracing_subscriber::fmt::init();

    tracing::info!("Running version {}", VERSION);

    let config = get_app_config()?;
    fs::write(
        &config.server.config_dump_path,
        serde_json::to_string_pretty(&config)?,
    )?;
    let config = Arc::new(config);

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
        .to_owned();
    let db = Database::connect(opt)
        .await
        .expect("Database connection failed");
    let auth_db = Arc::new(
        Storage::<String, MemoryAuthData>::open(Options::new(
            &config.database.auth_db_path,
            &format!("{}-auth.db", PROJECT_NAME),
            1000,
            StorageType::DiskCopies,
            true,
        ))
        .await
        .unwrap(),
    );

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
    let recalculate_user_summary_job_storage = create_storage(pool.clone()).await;
    let update_metadata_job_storage = create_storage(pool.clone()).await;
    let update_exercise_job_storage = create_storage(pool.clone()).await;

    let app_services = create_app_services(
        db.clone(),
        auth_db.clone(),
        s3_client,
        config.clone(),
        &import_media_storage,
        &user_created_job_storage,
        &update_exercise_job_storage,
        &update_metadata_job_storage,
        &recalculate_user_summary_job_storage,
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
        .allow_origin(
            config
                .server
                .cors_origins
                .iter()
                .map(|f| f.parse().unwrap())
                .collect_vec(),
        )
        .allow_credentials(true);

    let webhook_routes = Router::new().route(
        "/integrations/:integration/:user_hash_id",
        post(integration_webhook),
    );

    let app_routes = Router::new()
        .nest("/webhooks", webhook_routes)
        .route("/config", get(config_handler))
        .route("/upload", post(upload_handler))
        .route("/graphql", get(graphql_playground).post(graphql_handler))
        .route("/export", get(json_export))
        .fallback(static_handler)
        .layer(Extension(app_services.media_service.clone()))
        .layer(Extension(app_services.file_storage_service.clone()))
        .layer(Extension(schema))
        .layer(Extension(config.clone()))
        .layer(TowerTraceLayer::new_for_http())
        .layer(TowerCatchPanicLayer::new())
        .layer(CookieManagerLayer::new())
        .layer(cors);

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
    let media_service_2 = app_services.media_service.clone();
    let media_service_3 = app_services.media_service.clone();
    let media_service_4 = app_services.media_service.clone();
    let media_service_6 = app_services.media_service.clone();
    let media_service_7 = app_services.media_service.clone();
    let exercise_service_1 = app_services.exercise_service.clone();

    let user_cleanup_every = config.scheduler.user_cleanup_every;
    let pull_every = config.integration.pull_every;

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
                    .layer(ApalisExtension(media_service_2.clone()))
                    .build_fn(general_media_cleanup_jobs)
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
            .register_with_count(1, move |c| {
                WorkerBuilder::new(format!("import_media-{c}"))
                    .layer(ApalisTraceLayer::new())
                    .layer(ApalisExtension(importer_service_1.clone()))
                    .with_storage(import_media_storage.clone())
                    .build_fn(import_media)
            })
            .register_with_count(1, move |c| {
                WorkerBuilder::new(format!("user_created_job-{c}"))
                    .layer(ApalisTraceLayer::new())
                    .layer(ApalisExtension(media_service_4.clone()))
                    .with_storage(user_created_job_storage.clone())
                    .build_fn(user_created_job)
            })
            .register_with_count(1, move |c| {
                WorkerBuilder::new(format!("recalculate_user_summary_job-{c}"))
                    .layer(ApalisTraceLayer::new())
                    .layer(ApalisExtension(media_service_6.clone()))
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
                    .layer(ApalisExtension(media_service_7.clone()))
                    .with_storage(update_metadata_job_storage.clone())
                    .build_fn(update_metadata_job)
            })
            .register_with_count(1, move |c| {
                WorkerBuilder::new(format!("update_exercise_job-{c}"))
                    .layer(ApalisTraceLayer::new())
                    .layer(ApalisRateLimitLayer::new(50, Duration::new(5, 0)))
                    .layer(ApalisExtension(exercise_service_1.clone()))
                    .with_storage(update_exercise_job_storage.clone())
                    .build_fn(update_exercise_job)
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
