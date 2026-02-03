use std::{path::PathBuf, sync::Arc};

use anyhow::Result;
use apalis::prelude::TaskSink;
use apalis_codec::json::JsonCodec;
use apalis_sqlite::{SqliteStorage, shared::SharedFetcher};
use background_models::{
    ApplicationJob, HpApplicationJob, LpApplicationJob, MpApplicationJob, SingleApplicationJob,
};
use bon::bon;
use chrono::Utc;
use config_definition::AppConfig;
use sea_orm::prelude::DateTimeUtc;
use sea_orm_tracing::TracedConnection;

pub type JobStorage<T> = SqliteStorage<T, JsonCodec<Vec<u8>>, SharedFetcher<Vec<u8>>>;

pub struct SupportingService {
    pub db: TracedConnection,
    pub config: Arc<AppConfig>,
    pub log_file_path: PathBuf,
    pub timezone: chrono_tz::Tz,
    pub server_start_time: DateTimeUtc,

    lp_application_job: JobStorage<LpApplicationJob>,
    hp_application_job: JobStorage<HpApplicationJob>,
    mp_application_job: JobStorage<MpApplicationJob>,
    single_application_job: JobStorage<SingleApplicationJob>,
}

#[bon]
impl SupportingService {
    #[builder]
    pub async fn new(
        db: &TracedConnection,
        config: Arc<AppConfig>,
        log_file_path: PathBuf,
        timezone: chrono_tz::Tz,
        lp_application_job: JobStorage<LpApplicationJob>,
        mp_application_job: JobStorage<MpApplicationJob>,
        hp_application_job: JobStorage<HpApplicationJob>,
        single_application_job: JobStorage<SingleApplicationJob>,
    ) -> Self {
        Self {
            config,
            timezone,
            log_file_path,
            db: db.clone(),
            lp_application_job,
            mp_application_job,
            hp_application_job,
            single_application_job,
            server_start_time: Utc::now(),
        }
    }

    pub async fn perform_application_job(&self, job: ApplicationJob) -> Result<()> {
        match job {
            ApplicationJob::Lp(job) => self.lp_application_job.clone().push(job).await?,
            ApplicationJob::Hp(job) => self.hp_application_job.clone().push(job).await?,
            ApplicationJob::Mp(job) => self.mp_application_job.clone().push(job).await?,
            ApplicationJob::Single(job) => self.single_application_job.clone().push(job).await?,
        }
        Ok(())
    }
}
