use std::{
    env,
    fs::{self, create_dir_all},
    path::PathBuf,
    str::FromStr,
    sync::{Arc, Mutex},
};

use anyhow::{bail, Result};
use apalis::{
    layers::WorkerBuilderExt,
    prelude::{MemoryStorage, Monitor, WorkerBuilder, WorkerFactoryFn},
};
use apalis_cron::{CronStream, Schedule};
use aws_sdk_s3::config::Region;
use common_utils::{ryot_log, PROJECT_NAME, TEMP_DIR};
use dependent_models::CompleteExport;
use env_utils::APP_VERSION;
use logs_wheel::LogFileInitializer;
use migrations::Migrator;
use schematic::schema::{SchemaGenerator, TypeScriptRenderer, YamlTemplateRenderer};
use sea_orm::{ConnectionTrait, Database, DatabaseConnection};
use sea_orm_migration::MigratorTrait;
use tokio::{
    join,
    net::TcpListener,
    time::{sleep, Duration},
};
use tracing_subscriber::{fmt, layer::SubscriberExt};

use crate::{
    common::create_app_services,
    job::{
        perform_hp_application_job, perform_lp_application_job, perform_mp_application_job,
        run_background_jobs, run_frequent_jobs,
    },
};

mod common;
mod job;

static BASE_DIR: &str = env!("CARGO_MANIFEST_DIR");
static LOGGING_ENV_VAR: &str = "RUST_LOG";

#[tokio::main]
async fn main() -> Result<()> {
    #[cfg(debug_assertions)]
    dotenvy::dotenv().ok();

    match env::var(LOGGING_ENV_VAR).ok() {
        Some(v) => {
            if !v.contains("sea_orm") {
                env::set_var(LOGGING_ENV_VAR, format!("{},sea_orm=info", v));
            }
        }
        None => env::set_var(LOGGING_ENV_VAR, "ryot=info,sea_orm=info"),
    }
    init_tracing()?;

    ryot_log!(info, "Running version: {}", APP_VERSION);

    let config = Arc::new(config::load_app_config()?);
    if config.server.sleep_before_startup_seconds > 0 {
        let duration = Duration::from_secs(config.server.sleep_before_startup_seconds);
        ryot_log!(warn, "Sleeping for {:?} before starting up...", duration);
        sleep(duration).await;
    }

    let sync_every_minutes = config.integration.sync_every_minutes;
    let disable_background_jobs = config.server.disable_background_jobs;

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

    if let Err(err) = migrate_from_v7_if_applicable(&db).await {
        ryot_log!(error, "Migration from v7 failed: {}", err);
        bail!("There was an error migrating from v7.")
    }

    if let Err(err) = Migrator::up(&db, None).await {
        ryot_log!(error, "Database migration failed: {}", err);
        bail!("There was an error running the database migrations.");
    };

    let lp_application_job_storage = MemoryStorage::new();
    let mp_application_job_storage = MemoryStorage::new();
    let hp_application_job_storage = MemoryStorage::new();

    let tz: chrono_tz::Tz = env::var("TZ")
        .map(|s| s.parse().unwrap())
        .unwrap_or_else(|_| chrono_tz::Etc::GMT);
    ryot_log!(info, "Timezone: {}", tz);

    let (app_router, app_services) = create_app_services(
        db,
        tz,
        s3_client,
        config,
        &lp_application_job_storage,
        &mp_application_job_storage,
        &hp_application_job_storage,
    )
    .await;

    if cfg!(debug_assertions) {
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

    let host = env::var("BACKEND_HOST").unwrap_or_else(|_| "0.0.0.0".to_owned());
    let port = env::var("BACKEND_PORT")
        .unwrap_or_else(|_| "5000".to_owned())
        .parse::<usize>()
        .unwrap();
    let listener = TcpListener::bind(format!("{host}:{port}")).await.unwrap();
    ryot_log!(info, "Listening on: {}", listener.local_addr()?);

    let monitor = Monitor::new()
        .register(
            WorkerBuilder::new("daily_background_jobs")
                .enable_tracing()
                .catch_panic()
                .data(app_services.clone())
                .backend(
                    // every day
                    CronStream::new_with_timezone(Schedule::from_str("0 0 0 * * *").unwrap(), tz),
                )
                .build_fn(run_background_jobs),
        )
        .register(
            WorkerBuilder::new("frequent_jobs")
                .enable_tracing()
                .catch_panic()
                .data(app_services.clone())
                .backend(CronStream::new_with_timezone(
                    Schedule::from_str(&format!("0 */{} * * * *", sync_every_minutes)).unwrap(),
                    tz,
                ))
                .build_fn(run_frequent_jobs),
        )
        // application jobs
        .register(
            WorkerBuilder::new("perform_hp_application_job")
                .catch_panic()
                .enable_tracing()
                .data(app_services.clone())
                .backend(hp_application_job_storage)
                .build_fn(perform_hp_application_job),
        )
        .register(
            WorkerBuilder::new("perform_mp_application_job")
                .catch_panic()
                .enable_tracing()
                .rate_limit(5, Duration::new(5, 0))
                .data(app_services.clone())
                .backend(mp_application_job_storage)
                .build_fn(perform_mp_application_job),
        )
        .register(
            WorkerBuilder::new("perform_lp_application_job")
                .catch_panic()
                .enable_tracing()
                .rate_limit(20, Duration::new(5, 0))
                .data(app_services)
                .backend(lp_application_job_storage)
                .build_fn(perform_lp_application_job),
        )
        .run();

    let http = axum::serve(listener, app_router.into_make_service());

    if disable_background_jobs {
        let _ = join!(http);
    } else {
        let _ = join!(monitor, http);
    }

    Ok(())
}

fn init_tracing() -> Result<()> {
    let tmp_dir = PathBuf::new().join(TEMP_DIR);
    create_dir_all(&tmp_dir)?;
    let log_file = LogFileInitializer {
        max_n_old_files: 2,
        directory: tmp_dir,
        filename: PROJECT_NAME,
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

async fn migrate_from_v7_if_applicable(db: &DatabaseConnection) -> Result<()> {
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
            WHERE version = 'm20240825_is_v7_migration'
        ) THEN
            IF NOT EXISTS (
                SELECT 1 FROM seaql_migrations
                WHERE version = 'm20250117_is_last_v7_migration'
            ) THEN
                RAISE EXCEPTION 'Final migration for v7 does not exist, upgrade aborted.';
            END IF;

            DELETE FROM seaql_migrations;
            INSERT INTO seaql_migrations (version, applied_at) VALUES
                ('m20230403_create_extensions', 1684693316),
                ('m20230404_create_user', 1684693317),
                ('m20230410_create_metadata', 1684693318),
                ('m20230411_create_metadata_group', 1684693319),
                ('m20230413_create_person', 1684693320),
                ('m20230419_create_seen', 1684693321),
                ('m20230502_create_genre', 1684693322),
                ('m20230504_create_collection', 1684693323),
                ('m20230505_create_exercise', 1684693324),
                ('m20230506_create_workout_template', 1684693325),
                ('m20230507_create_workout', 1684693326),
                ('m20230508_create_review', 1684693327),
                ('m20230509_create_import_report', 1684693328),
                ('m20230820_create_user_measurement', 1684693329),
                ('m20230912_create_calendar_event', 1684693330),
                ('m20231016_create_collection_to_entity', 1684693331),
                ('m20231017_create_user_to_entity', 1684693332),
                ('m20231219_create_metadata_relations', 1684693333),
                ('m20240607_create_integration', 1684693334),
                ('m20240712_create_notification_platform', 1684693335),
                ('m20240714_create_access_link', 1684693336),
                ('m20240827_create_daily_user_activity', 1684693337),
                ('m20240904_create_monitored_entity', 1684693338),
                ('m20241004_create_application_cache', 1684693339),
                ('m20241214_create_user_notification', 1684693340);
        END IF;
    END IF;
END $$;
    "#,
    )
    .await?;
    Ok(())
}
