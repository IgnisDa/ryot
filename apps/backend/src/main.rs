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
use english_to_cron::str_cron_syntax;
use env_utils::APP_VERSION;
use migrations_sql::Migrator;
use opentelemetry_otlp::WithExportConfig;
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
    common::create_app_dependencies,
    job::{
        perform_hp_application_job, perform_lp_application_job, perform_mp_application_job,
        perform_single_application_job, run_frequent_cron_jobs, run_infrequent_cron_jobs,
    },
};

mod common;
mod job;

static LOGGING_ENV_VAR: &str = "RUST_LOG";
static BASE_DIR: &str = env!("CARGO_MANIFEST_DIR");

#[tokio::main]
async fn main() -> Result<()> {
    #[cfg(debug_assertions)]
    dotenvy::dotenv().ok();

    match env::var(LOGGING_ENV_VAR).ok() {
        None => unsafe { env::set_var(LOGGING_ENV_VAR, "ryot=info,sea_orm=info") },
        Some(v) => {
            if !v.contains("sea_orm") {
                unsafe { env::set_var(LOGGING_ENV_VAR, format!("{v},sea_orm=info")) };
            }
        }
    }
    let (log_file_path, tracer_provider) = init_tracing()?;

    ryot_log!(info, "Running version: {}", APP_VERSION);

    let config = Arc::new(config_definition::load_app_config()?);

    let tz: chrono_tz::Tz = config.tz.parse().unwrap();
    ryot_log!(info, "Timezone: {}", tz);

    let port = config.server.backend_port;
    let host = config.server.backend_host.clone();
    let disable_background_jobs = config.server.disable_background_jobs;

    let (infrequent_scheduler, frequent_scheduler) = get_cron_schedules(&config, tz)?;

    if config.server.sleep_before_startup_seconds > 0 {
        let duration = Duration::from_secs(config.server.sleep_before_startup_seconds);
        ryot_log!(warn, "Sleeping for {:?} before starting up...", duration);
        sleep(duration).await;
    }

    let config_dump_path = PathBuf::new()
        .join(get_temporary_directory())
        .join("config.json");
    fs::write(config_dump_path, serde_json::to_string_pretty(&config)?)?;

    let db = Database::connect(config.database.url.clone())
        .await
        .expect("Database connection failed");

    migrate_from_v9_if_applicable(&db)
        .await
        .context("There was an error migrating from v9")?;

    if let Err(err) = Migrator::up(&db, None).await {
        ryot_log!(error, "Database migration failed: {}", err);
        bail!("There was an error running the database migrations.");
    };

    let lp_application_job_storage = MemoryStorage::new();
    let mp_application_job_storage = MemoryStorage::new();
    let hp_application_job_storage = MemoryStorage::new();
    let single_application_job_storage = MemoryStorage::new();

    let (app_router, supporting_service) = create_app_dependencies()
        .db(db)
        .timezone(tz)
        .config(config)
        .log_file_path(log_file_path)
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
                .data(supporting_service.clone())
                .backend(CronStream::new_with_timezone(infrequent_scheduler, tz))
                .build_fn(run_infrequent_cron_jobs),
        )
        .register(
            WorkerBuilder::new("frequent_cron_jobs")
                .enable_tracing()
                .catch_panic()
                .data(supporting_service.clone())
                .backend(CronStream::new_with_timezone(frequent_scheduler, tz))
                .build_fn(run_frequent_cron_jobs),
        )
        // application jobs
        .register(
            WorkerBuilder::new("perform_single_application_job")
                .catch_panic()
                .enable_tracing()
                .concurrency(1)
                .data(supporting_service.clone())
                .backend(single_application_job_storage)
                .build_fn(perform_single_application_job),
        )
        .register(
            WorkerBuilder::new("perform_hp_application_job")
                .catch_panic()
                .enable_tracing()
                .data(supporting_service.clone())
                .backend(hp_application_job_storage)
                .build_fn(perform_hp_application_job),
        )
        .register(
            WorkerBuilder::new("perform_mp_application_job")
                .catch_panic()
                .enable_tracing()
                .rate_limit(10, Duration::new(5, 0))
                .data(supporting_service.clone())
                .backend(mp_application_job_storage)
                .build_fn(perform_mp_application_job),
        )
        .register(
            WorkerBuilder::new("perform_lp_application_job")
                .catch_panic()
                .enable_tracing()
                .rate_limit(40, Duration::new(5, 0))
                .data(supporting_service.clone())
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

    if let Err(err) = tracer_provider.shutdown() {
        ryot_log!(warn, "Failed to shutdown OTLP tracer provider: {err}");
    }

    Ok(())
}

fn init_tracing() -> Result<(PathBuf, opentelemetry_sdk::trace::SdkTracerProvider)> {
    let tmp_dir = PathBuf::new().join(get_temporary_directory());
    let file_path = tmp_dir.join(PROJECT_NAME);
    create_dir_all(&tmp_dir)?;
    let file_appender = tracing_appender::rolling::never(tmp_dir, PROJECT_NAME);
    let writer = Mutex::new(file_appender);

    opentelemetry::global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );
    let otlp_endpoint =
        env::var("OTEL_EXPORTER_OTLP_ENDPOINT").unwrap_or_else(|_| "http://localhost:4317".into());
    let resource = opentelemetry_sdk::Resource::builder()
        .with_attribute(opentelemetry::KeyValue::new("service.name", PROJECT_NAME))
        .with_attribute(opentelemetry::KeyValue::new("service.version", APP_VERSION))
        .build();
    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint(otlp_endpoint)
        .build()
        .context("Unable to build OTLP span exporter")?;
    let tracer_provider = opentelemetry_sdk::trace::SdkTracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(resource)
        .build();
    opentelemetry::global::set_tracer_provider(tracer_provider.clone());
    let tracer = opentelemetry::global::tracer(PROJECT_NAME);

    tracing::subscriber::set_global_default(
        tracing_subscriber::registry()
            .with(tracing_subscriber::EnvFilter::from_default_env())
            .with(fmt::Layer::default())
            .with(fmt::Layer::default().with_writer(writer).with_ansi(false))
            .with(tracing_opentelemetry::OpenTelemetryLayer::new(tracer)),
    )
    .expect("Unable to set global tracing subscriber");
    Ok((file_path, tracer_provider))
}

fn get_cron_schedules(config: &Arc<AppConfig>, tz: chrono_tz::Tz) -> Result<(Schedule, Schedule)> {
    let infrequent_format = str_cron_syntax(&config.scheduler.infrequent_cron_jobs_schedule)?;
    let infrequent_scheduler = Schedule::from_str(&infrequent_format)?;
    log_cron_schedule(stringify!(infrequent_scheduler), &infrequent_scheduler, tz);

    let frequent_format = str_cron_syntax(&config.scheduler.frequent_cron_jobs_schedule)?;
    let frequent_scheduler = Schedule::from_str(&frequent_format)?;
    log_cron_schedule(stringify!(frequent_scheduler), &frequent_scheduler, tz);

    Ok((infrequent_scheduler, frequent_scheduler))
}

fn log_cron_schedule(name: &str, schedule: &Schedule, tz: chrono_tz::Tz) {
    let times = schedule.upcoming(tz).take(5).collect::<Vec<_>>();
    ryot_log!(info, "Schedule for {name:#?}: {times:?} and so on...");
}

async fn migrate_from_v9_if_applicable(db: &DatabaseConnection) -> Result<()> {
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
            WHERE version = 'm20250801_is_v9_migration'
        ) THEN
            IF NOT EXISTS (
                SELECT 1 FROM seaql_migrations
                WHERE version = 'm20251212_is_last_v9_migration'
            ) THEN
                RAISE EXCEPTION 'Final migration for v9 does not exist, upgrade aborted.';
            END IF;

            DELETE FROM seaql_migrations;
            INSERT INTO seaql_migrations (version, applied_at) VALUES
                ('m20230403_create_database_setup_requirements', 1684693316),
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
                ('m20241004_create_application_cache', 1684693340),
                ('m20250813_create_collection_entity_membership', 1684693341),
                ('m20251115_create_filter_preset', 1684693342),
                ('m20251128_create_entity_translation', 1684693343);
        END IF;
    END IF;
END $$;
    "#,
    )
    .await?;
    Ok(())
}
