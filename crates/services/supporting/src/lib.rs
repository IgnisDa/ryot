use std::sync::Arc;

use anyhow::Result;
use apalis::prelude::{MemoryStorage, MessageQueue};
use background_models::{ApplicationJob, HpApplicationJob, LpApplicationJob, MpApplicationJob};
use bon::bon;
use chrono::Utc;
use config_definition::AppConfig;
use sea_orm::{DatabaseConnection, prelude::DateTimeUtc};

pub struct SupportingService {
    pub is_oidc_enabled: bool,
    pub config: Arc<AppConfig>,
    pub db: DatabaseConnection,
    pub timezone: chrono_tz::Tz,
    pub server_start_time: DateTimeUtc,

    lp_application_job: MemoryStorage<LpApplicationJob>,
    hp_application_job: MemoryStorage<HpApplicationJob>,
    mp_application_job: MemoryStorage<MpApplicationJob>,
}

#[bon]
impl SupportingService {
    #[builder]
    pub async fn new(
        is_oidc_enabled: bool,
        config: Arc<AppConfig>,
        db: &DatabaseConnection,
        timezone: chrono_tz::Tz,
        lp_application_job: &MemoryStorage<LpApplicationJob>,
        mp_application_job: &MemoryStorage<MpApplicationJob>,
        hp_application_job: &MemoryStorage<HpApplicationJob>,
    ) -> Self {
        Self {
            config,
            timezone,
            db: db.clone(),
            is_oidc_enabled,
            server_start_time: Utc::now(),
            lp_application_job: lp_application_job.clone(),
            mp_application_job: mp_application_job.clone(),
            hp_application_job: hp_application_job.clone(),
        }
    }

    pub async fn perform_application_job(&self, job: ApplicationJob) -> Result<()> {
        match job {
            ApplicationJob::Lp(job) => {
                self.lp_application_job.clone().enqueue(job).await.ok();
            }
            ApplicationJob::Hp(job) => {
                self.hp_application_job.clone().enqueue(job).await.ok();
            }
            ApplicationJob::Mp(job) => {
                self.mp_application_job.clone().enqueue(job).await.ok();
            }
        }
        Ok(())
    }
}
