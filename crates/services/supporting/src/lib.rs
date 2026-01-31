use std::{path::PathBuf, sync::Arc};

use anyhow::Result;
use apalis::prelude::{MakeShared, TaskSink};
use apalis_sqlite::{CompactType, SharedSqliteStorage};
use background_models::{
    ApplicationJob, HpApplicationJob, LpApplicationJob, MpApplicationJob, SingleApplicationJob,
};
use bon::bon;
use chrono::Utc;
use config_definition::AppConfig;
use sea_orm::{DatabaseConnection, prelude::DateTimeUtc};

type DefaultCodec = apalis_codec::json::JsonCodec<CompactType>;
type SharedStorage = SharedSqliteStorage<DefaultCodec>;

type LpStorage = <SharedStorage as MakeShared<LpApplicationJob>>::Backend;
type HpStorage = <SharedStorage as MakeShared<HpApplicationJob>>::Backend;
type MpStorage = <SharedStorage as MakeShared<MpApplicationJob>>::Backend;
type SingleStorage = <SharedStorage as MakeShared<SingleApplicationJob>>::Backend;

pub struct SupportingService {
    pub is_oidc_enabled: bool,
    pub config: Arc<AppConfig>,
    pub db: DatabaseConnection,
    pub log_file_path: PathBuf,
    pub timezone: chrono_tz::Tz,
    pub server_start_time: DateTimeUtc,

    lp_application_job: LpStorage,
    hp_application_job: HpStorage,
    mp_application_job: MpStorage,
    single_application_job: SingleStorage,
}

#[bon]
impl SupportingService {
    #[builder]
    pub async fn new(
        is_oidc_enabled: bool,
        config: Arc<AppConfig>,
        log_file_path: PathBuf,
        db: &DatabaseConnection,
        timezone: chrono_tz::Tz,
        lp_application_job: LpStorage,
        mp_application_job: MpStorage,
        hp_application_job: HpStorage,
        single_application_job: SingleStorage,
    ) -> Self {
        Self {
            config,
            timezone,
            log_file_path,
            db: db.clone(),
            is_oidc_enabled,
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

pub type JobStorage<T> = <SharedStorage as MakeShared<T>>::Backend;
