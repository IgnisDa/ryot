use std::{
    env,
    fs::{self, create_dir_all},
    path::PathBuf,
    str::FromStr,
    sync::{Arc, Mutex},
};

use anyhow::{Context, Result, bail};
use apalis::{
    layers::WorkerBuilderExt,
    prelude::{MemoryStorage, Monitor, WorkerBuilder, WorkerFactoryFn},
};
use apalis_cron::{CronStream, Schedule};
use common_utils::{PROJECT_NAME, get_temporary_directory, ryot_log};
use config_definition::AppConfig;
use dependent_models::CompleteExport;
use env_utils::APP_VERSION;
use migrations_sql::Migrator;
use schematic::schema::{SchemaGenerator, TypeScriptRenderer, YamlTemplateRenderer};
use sea_orm::{ConnectionTrait, Database, DatabaseConnection};
use sea_orm_migration::MigratorTrait;
use tokio::{
    join,
    net::TcpListener,
    time::{Duration, sleep},
};
use tracing_subscriber::{fmt, layer::SubscriberExt};

use crate::{
    common::create_app_services,
    job::{
        perform_hp_application_job, perform_lp_application_job, perform_mp_application_job,
        perform_single_application_job, run_frequent_cron_jobs, run_infrequent_cron_jobs,
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
                unsafe { env::set_var(LOGGING_ENV_VAR, format!("{v},sea_orm=info")) };
            }
        }
        None => unsafe { env::set_var(LOGGING_ENV_VAR, "ryot=info,sea_orm=info") },
    }
    init_tracing()?;

    ryot_log!(info, "Running version: {}", APP_VERSION);

    let config = Arc::new(config_definition::load_app_config()?);
    if config.server.sleep_before_startup_seconds > 0 {
        let duration = Duration::from_secs(config.server.sleep_before_startup_seconds);
        ryot_log!(warn, "Sleeping for {:?} before starting up...", duration);
        sleep(duration).await;
    }

    let port = config.server.backend_port;
    let host = config.server.backend_host.clone();
    let disable_background_jobs = config.server.disable_background_jobs;
    let frequent_cron_jobs_every_minutes = config.scheduler.frequent_cron_jobs_every_minutes;
    let infrequent_cron_jobs_hours_format =
        config.scheduler.infrequent_cron_jobs_hours_format.clone();

    let tz: chrono_tz::Tz = env::var("TZ")
        .map(|s| s.parse().unwrap())
        .unwrap_or_else(|_| chrono_tz::Etc::GMT);
    ryot_log!(info, "Timezone: {}", tz);

    let infrequent_scheduler =
        Schedule::from_str(&format!("0 0 {infrequent_cron_jobs_hours_format} * * *")).unwrap();
    log_cron_schedule(stringify!(infrequent_scheduler), &infrequent_scheduler, &tz);

    let frequent_scheduler =
        Schedule::from_str(&format!("0 */{frequent_cron_jobs_every_minutes} * * * *")).unwrap();
    log_cron_schedule(stringify!(frequent_scheduler), &frequent_scheduler, &tz);

    let config_dump_path = PathBuf::new()
        .join(get_temporary_directory())
        .join("config.json");
    fs::write(config_dump_path, serde_json::to_string_pretty(&config)?)?;

    let db = Database::connect(config.database.url.clone())
        .await
        .expect("Database connection failed");

    migrate_from_v8_if_applicable(&db)
        .await
        .context("There was an error migrating from v8")?;

    if let Err(err) = Migrator::up(&db, None).await {
        ryot_log!(error, "Database migration failed: {}", err);
        bail!("There was an error running the database migrations.");
    };

    let lp_application_job_storage = MemoryStorage::new();
    let mp_application_job_storage = MemoryStorage::new();
    let hp_application_job_storage = MemoryStorage::new();
    let single_application_job_storage = MemoryStorage::new();

    let (app_router, app_services) = create_app_services()
        .db(db)
        .timezone(tz)
        .config(config)
        .lp_application_job(&lp_application_job_storage)
        .mp_application_job(&mp_application_job_storage)
        .hp_application_job(&hp_application_job_storage)
        .single_application_job(&single_application_job_storage)
        .call()
        .await;

    if cfg!(debug_assertions) {
        // TODO: Once https://github.com/rust-lang/cargo/issues/3946 is resolved
        let base_dir = PathBuf::from(BASE_DIR)
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("apps")
            .join("docs")
            .join("src")
            .join("includes");

        let mut generator = SchemaGenerator::default();
        generator.add::<AppConfig>();
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

    let listener = TcpListener::bind(format!("{host}:{port}")).await.unwrap();
    ryot_log!(info, "Listening on: {}", listener.local_addr()?);

    let monitor = Monitor::new()
        .register(
            WorkerBuilder::new("infrequent_cron_jobs")
                .enable_tracing()
                .catch_panic()
                .data(app_services.clone())
                .backend(CronStream::new_with_timezone(infrequent_scheduler, tz))
                .build_fn(run_infrequent_cron_jobs),
        )
        .register(
            WorkerBuilder::new("frequent_cron_jobs")
                .enable_tracing()
                .catch_panic()
                .data(app_services.clone())
                .backend(CronStream::new_with_timezone(frequent_scheduler, tz))
                .build_fn(run_frequent_cron_jobs),
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
                .data(app_services.clone())
                .backend(lp_application_job_storage)
                .build_fn(perform_lp_application_job),
        )
        .register(
            WorkerBuilder::new("perform_single_application_job")
                .catch_panic()
                .enable_tracing()
                .rate_limit(1, Duration::new(1, 0))
                .data(app_services)
                .backend(single_application_job_storage)
                .build_fn(perform_single_application_job),
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
    let tmp_dir = PathBuf::new().join(get_temporary_directory());
    create_dir_all(&tmp_dir)?;
    let file_appender = tracing_appender::rolling::never(tmp_dir, PROJECT_NAME);
    let writer = Mutex::new(file_appender);
    tracing::subscriber::set_global_default(
        fmt::Subscriber::builder()
            .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
            .finish()
            .with(fmt::Layer::default().with_writer(writer).with_ansi(false)),
    )
    .expect("Unable to set global tracing subscriber");
    Ok(())
}

fn log_cron_schedule(name: &str, schedule: &Schedule, tz: &chrono_tz::Tz) {
    let times = schedule.upcoming(*tz).take(5).collect::<Vec<_>>();
    ryot_log!(info, "Schedule for {:#?}: {:?} and so on...", name, times);
}

async fn migrate_from_v8_if_applicable(db: &DatabaseConnection) -> Result<()> {
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
            WHERE version = 'm20250118_is_v8_migration'
        ) THEN
            IF NOT EXISTS (
                SELECT 1 FROM seaql_migrations
                WHERE version = 'm20250731_is_last_v8_migration'
            ) THEN
                RAISE EXCEPTION 'Final migration for v8 does not exist, upgrade aborted.';
            END IF;

            DELETE FROM seaql_migrations;
            INSERT INTO seaql_migrations (version, applied_at) VALUES
                ('m20230403_create_extensions', 1684693316),
                ('m20230404_create_user', 1684693317),
                ('m20230410_create_metadata', 1684693318),
                ('m20230411_create_metadata_group', 1684693319),
                ('m20230413_create_person', 1684693320),
                ('m20230502_create_genre', 1684693322),
                ('m20230504_create_collection', 1684693323),
                ('m20230505_create_exercise', 1684693324),
                ('m20230506_create_workout_template', 1684693325),
                ('m20230507_create_workout', 1684693326),
                ('m20230508_create_review', 1684693327),
                ('m20230510_create_seen', 1684693321),
                ('m20230513_create_import_report', 1684693328),
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
                ('m20241004_create_application_cache', 1684693339);
        END IF;
    END IF;
END $$;
    "#,
    )
    .await?;
    Ok(())
}
