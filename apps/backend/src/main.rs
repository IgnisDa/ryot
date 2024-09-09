use std::{
    env,
    fs::{self, create_dir_all},
    path::PathBuf,
    str::FromStr,
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::{bail, Result};
use apalis::{
    cron::{CronStream, Schedule},
    layers::{
        limit::RateLimitLayer as ApalisRateLimitLayer, tracing::TraceLayer as ApalisTraceLayer,
    },
    prelude::{MemoryStorage, MessageQueue, Monitor, WorkerBuilder, WorkerFactoryFn},
    utils::TokioExecutor,
};
use aws_sdk_s3::config::Region;
use background::ApplicationJob;
use chrono::{TimeZone, Utc};
use common_utils::{ryot_log, COMPILATION_TIMESTAMP, PROJECT_NAME, TEMP_DIR, VERSION};
use database_models::prelude::Exercise;
use dependent_models::CompleteExport;
use logs_wheel::LogFileInitializer;
use migrations::Migrator;
use sea_orm::{ConnectionTrait, Database, DatabaseConnection, EntityTrait, PaginatorTrait};
use sea_orm_migration::MigratorTrait;
use tokio::{
    join,
    net::TcpListener,
    time::{sleep, Duration as TokioDuration},
};
use tower::buffer::BufferLayer;
use tracing_subscriber::{fmt, layer::SubscriberExt};

use crate::{
    common::create_app_services,
    job::{
        background_jobs, perform_application_job, perform_core_application_job,
        sync_integrations_data,
    },
};

mod common;
mod job;

static BASE_DIR: &str = env!("CARGO_MANIFEST_DIR");

#[tokio::main]
async fn main() -> Result<()> {
    #[cfg(debug_assertions)]
    dotenvy::dotenv().ok();

    if env::var("RUST_LOG").is_err() {
        env::set_var("RUST_LOG", "ryot=info,sea_orm=info");
    }
    init_tracing()?;

    ryot_log!(info, "Running version: {}", VERSION);

    let config = Arc::new(config::load_app_config()?);
    if config.server.sleep_before_startup_seconds > 0 {
        let duration = TokioDuration::from_secs(config.server.sleep_before_startup_seconds);
        ryot_log!(info, "Sleeping for {:?} before starting up...", duration);
        sleep(duration).await;
    }

    let rate_limit_count = config.scheduler.rate_limit_num;
    let sync_every_minutes = config.integration.sync_every_minutes;
    let disable_background_jobs = config.server.disable_background_jobs;

    let compile_timestamp = Utc.timestamp_opt(COMPILATION_TIMESTAMP, 0).unwrap();
    ryot_log!(debug, "Compiled at: {}", compile_timestamp);

    let config_dump_path = PathBuf::new().join(TEMP_DIR).join("config.json");
    fs::write(config_dump_path, serde_json::to_string_pretty(&config)?)?;

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

    let db = Database::connect(config.database.url.clone())
        .await
        .expect("Database connection failed");

    if let Err(err) = migrate_from_v6(&db).await {
        ryot_log!(error, "Migration from v6 failed: {}", err);
        bail!("There was an error migrating from v6.")
    }

    if let Err(err) = Migrator::up(&db, None).await {
        ryot_log!(error, "Database migration failed: {}", err);
        bail!("There was an error running the database migrations.");
    };

    let perform_application_job_storage = MemoryStorage::new();
    let perform_core_application_job_storage = MemoryStorage::new();

    let tz: chrono_tz::Tz = env::var("TZ")
        .map(|s| s.parse().unwrap())
        .unwrap_or_else(|_| chrono_tz::Etc::GMT);
    ryot_log!(info, "Timezone: {}", tz);

    let app_services = create_app_services(
        db.clone(),
        s3_client,
        config,
        &perform_application_job_storage,
        &perform_core_application_job_storage,
        tz,
    )
    .await;

    perform_application_job_storage
        .enqueue(ApplicationJob::SyncIntegrationsData)
        .await
        .unwrap();

    if Exercise::find().count(&db).await? == 0 {
        ryot_log!(
            info,
            "Instance does not have exercises data. Deploying job to download them..."
        );
        perform_application_job_storage
            .enqueue(ApplicationJob::UpdateExerciseLibrary)
            .await
            .unwrap();
    }

    if cfg!(debug_assertions) {
        use schematic::schema::{SchemaGenerator, TypeScriptRenderer, YamlTemplateRenderer};

        // TODO: Once https://github.com/rust-lang/cargo/issues/3946 is resolved
        let base_dir = PathBuf::from(BASE_DIR)
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("docs")
            .join("includes");

        let mut generator = SchemaGenerator::default();
        generator.add::<config::AppConfig>();
        generator
            .generate(
                base_dir.join("backend-config-schema.yaml"),
                YamlTemplateRenderer::default(),
            )
            .ok();

        let mut generator = SchemaGenerator::default();
        generator.add::<CompleteExport>();
        generator
            .generate(
                base_dir.join("export-schema.ts"),
                TypeScriptRenderer::default(),
            )
            .ok();
    }

    let port = env::var("BACKEND_PORT")
        .unwrap_or_else(|_| "5000".to_owned())
        .parse::<usize>()
        .unwrap();
    let listener = TcpListener::bind(format!("0.0.0.0:{port}")).await.unwrap();
    ryot_log!(info, "Listening on: {}", listener.local_addr()?);

    let importer_service_1 = app_services.importer_service.clone();
    let exporter_service_1 = app_services.exporter_service.clone();
    let media_service_2 = app_services.miscellaneous_service.clone();
    let media_service_4 = app_services.miscellaneous_service.clone();
    let media_service_5 = app_services.miscellaneous_service.clone();
    let exercise_service_1 = app_services.exercise_service.clone();
    let statistics_service_1 = app_services.statistics_service.clone();
    let integration_service_1 = app_services.integration_service.clone();

    let monitor = async {
        Monitor::<TokioExecutor>::new()
            .register_with_count(
                1,
                WorkerBuilder::new("background_jobs")
                    .stream(
                        // every day
                        CronStream::new_with_timezone(
                            Schedule::from_str("0 0 0 * * *").unwrap(),
                            tz,
                        )
                        .into_stream(),
                    )
                    .layer(ApalisTraceLayer::new())
                    .data(media_service_2.clone())
                    .build_fn(background_jobs),
            )
            .register_with_count(
                1,
                WorkerBuilder::new("sync_integrations_data")
                    .stream(
                        CronStream::new_with_timezone(
                            Schedule::from_str(&format!("0 */{} * * * *", sync_every_minutes))
                                .unwrap(),
                            tz,
                        )
                        .into_stream(),
                    )
                    .layer(ApalisTraceLayer::new())
                    .data(integration_service_1.clone())
                    .build_fn(sync_integrations_data),
            )
            // application jobs
            .register_with_count(
                1,
                WorkerBuilder::new("perform_core_application_job")
                    .layer(ApalisTraceLayer::new())
                    .data(media_service_5.clone())
                    .source(perform_core_application_job_storage)
                    .build_fn(perform_core_application_job),
            )
            .register_with_count(
                3,
                WorkerBuilder::new("perform_application_job")
                    .data(importer_service_1.clone())
                    .data(exporter_service_1.clone())
                    .data(media_service_4.clone())
                    .data(exercise_service_1.clone())
                    .data(statistics_service_1.clone())
                    .source(perform_application_job_storage)
                    // DEV: Had to do this fuckery because of https://github.com/geofmureithi/apalis/issues/297
                    .chain(|s| {
                        s.layer(BufferLayer::new(1024))
                            .layer(ApalisRateLimitLayer::new(
                                rate_limit_count,
                                Duration::new(5, 0),
                            ))
                            .layer(ApalisTraceLayer::new())
                    })
                    .build_fn(perform_application_job),
            )
            .run()
            .await
            .unwrap();
    };

    let http = async {
        axum::serve(listener, app_services.app_router.into_make_service())
            .await
            .unwrap();
    };

    if disable_background_jobs {
        join!(http);
    } else {
        join!(monitor, http);
    }

    Ok(())
}

fn init_tracing() -> Result<()> {
    let tmp_dir = PathBuf::new().join(TEMP_DIR);
    create_dir_all(&tmp_dir)?;
    let log_file = LogFileInitializer {
        directory: tmp_dir,
        filename: PROJECT_NAME,
        max_n_old_files: 2,
        preferred_max_file_size_mib: 1,
    }
    .init()?;
    let writer = Mutex::new(log_file);
    tracing::subscriber::set_global_default(
        fmt::Subscriber::builder()
            .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
            .finish()
            .with(fmt::Layer::default().with_writer(writer).with_ansi(false)),
    )
    .expect("Unable to set global tracing subscriber");
    Ok(())
}

// upgrade from v6 ONLY IF APPLICABLE
async fn migrate_from_v6(db: &DatabaseConnection) -> Result<()> {
    db.execute_unprepared(
        r#"
DO $$
BEGIN
    IF EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'seaql_migrations'
    ) THEN
        IF EXISTS (
            SELECT 1 FROM seaql_migrations
            WHERE version = 'm20240606_is_v6_migration'
        ) THEN
            IF NOT EXISTS (
                SELECT 1 FROM seaql_migrations
                WHERE version = 'm20240817_is_last_v6_migration'
            ) THEN
                RAISE EXCEPTION 'Final migration for v6 does not exist, upgrade aborted.';
            END IF;

            DELETE FROM seaql_migrations;
            INSERT INTO seaql_migrations (version, applied_at) VALUES
                ('m20230409_create_extensions', 1684693316),
                ('m20230410_create_metadata', 1684693316),
                ('m20230413_create_person', 1684693316),
                ('m20230417_create_user', 1684693316),
                ('m20230419_create_seen', 1684693316),
                ('m20230501_create_metadata_group', 1684693316),
                ('m20230502_create_genre', 1684693316),
                ('m20230504_create_collection', 1684693316),
                ('m20230822_create_exercise', 1684693316),
                ('m20230819_create_workout', 1684693316),
                ('m20230505_create_review', 1684693316),
                ('m20230509_create_import_report', 1684693316),
                ('m20230820_create_user_measurement', 1684693316),
                ('m20230912_create_calendar_event', 1684693316),
                ('m20231016_create_collection_to_entity', 1684693316),
                ('m20231017_create_user_to_entity', 1684693316),
                ('m20231219_create_metadata_relations', 1684693316),
                ('m20240509_create_user_to_collection', 1717207621),
                ('m20240531_create_queued_notification', 1717207621),
                ('m20240607_create_integration', 1723854703),
                ('m20240712_create_notification_platform', 1723854703),
                ('m20240713_create_user_summary', 1723854703);
        END IF;
    END IF;
END $$;
    "#,
    )
    .await?;
    Ok(())
}
