use std::{path::PathBuf, sync::Arc};

use anyhow::Result;
use apalis::prelude::TaskSink;
use apalis_file_storage::JsonStorage;
use background_models::{
    ApplicationJob, HpApplicationJob, LpApplicationJob, MpApplicationJob, SingleApplicationJob,
};
use bon::bon;
use chrono::Utc;
use config_definition::AppConfig;
use sea_orm::{DatabaseConnection, prelude::DateTimeUtc};

pub struct SupportingService {
    pub is_oidc_enabled: bool,
    pub config: Arc<AppConfig>,
    pub db: DatabaseConnection,
    pub log_file_path: PathBuf,
    pub timezone: chrono_tz::Tz,
    pub server_start_time: DateTimeUtc,

    lp_application_job: JsonStorage<LpApplicationJob>,
    hp_application_job: JsonStorage<HpApplicationJob>,
    mp_application_job: JsonStorage<MpApplicationJob>,
    single_application_job: JsonStorage<SingleApplicationJob>,
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
        lp_application_job: JsonStorage<LpApplicationJob>,
        mp_application_job: JsonStorage<MpApplicationJob>,
        hp_application_job: JsonStorage<HpApplicationJob>,
        single_application_job: JsonStorage<SingleApplicationJob>,
    ) -> Self {
        Self {
            config,
            timezone,
            log_file_path,
            db: db.clone(),
            is_oidc_enabled,
            server_start_time: Utc::now(),
            lp_application_job,
            mp_application_job,
            hp_application_job,
            single_application_job,
        }
    }

    pub async fn perform_application_job(&self, job: ApplicationJob) -> Result<()> {
        match job {
            ApplicationJob::Lp(job) => {
                let mut backend = self.lp_application_job.clone();
                backend.push(job).await.ok();
            }
            ApplicationJob::Hp(job) => {
                let mut backend = self.hp_application_job.clone();
                backend.push(job).await.ok();
            }
            ApplicationJob::Mp(job) => {
                let mut backend = self.mp_application_job.clone();
                backend.push(job).await.ok();
            }
            ApplicationJob::Single(job) => {
                let mut backend = self.single_application_job.clone();
                backend.push(job).await.ok();
            }
        }
        Ok(())
    }
}
