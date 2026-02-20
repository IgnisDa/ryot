use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    path::PathBuf,
    sync::Arc,
};

use anyhow::{Result, anyhow};
use apalis::prelude::TaskSink;
use apalis_codec::json::JsonCodec;
use apalis_sqlite::{SqliteStorage, fetcher::SqliteFetcher};
use background_models::{
    ApplicationJob, HpApplicationJob, LpApplicationJob, MpApplicationJob, SingleApplicationJob,
};
use bon::bon;
use chrono::Utc;
use config_definition::AppConfig;
use sea_orm::{DatabaseConnection, prelude::DateTimeUtc};

pub type JobStorage<T> = SqliteStorage<T, JsonCodec<Vec<u8>>, SqliteFetcher>;

pub struct SupportingService {
    pub config: Arc<AppConfig>,
    pub db: DatabaseConnection,
    pub log_file_path: PathBuf,
    pub timezone: chrono_tz::Tz,
    pub server_start_time: DateTimeUtc,

    lp_application_job: JobStorage<LpApplicationJob>,
    hp_application_job: JobStorage<HpApplicationJob>,
    mp_application_job: JobStorage<MpApplicationJob>,
    single_application_jobs: Vec<JobStorage<SingleApplicationJob>>,
}

fn single_application_job_key(job: &SingleApplicationJob) -> String {
    match job {
        SingleApplicationJob::ImportFromExternalSource(user_id, _) => format!("user:{user_id}"),
        SingleApplicationJob::BulkMetadataProgressUpdate(user_id, _) => format!("user:{user_id}"),
        SingleApplicationJob::ProcessIntegrationWebhook(integration_id, _) => {
            format!("integration:{integration_id}")
        }
    }
}

fn single_application_job_shard_index(job: &SingleApplicationJob, shard_count: usize) -> usize {
    assert!(
        shard_count > 0,
        "single_application_job_shard_index: shard_count must be > 0"
    );
    let mut hasher = DefaultHasher::new();
    let key = single_application_job_key(job);
    key.hash(&mut hasher);
    (hasher.finish() as usize) % shard_count
}

#[bon]
impl SupportingService {
    #[builder]
    pub async fn new(
        config: Arc<AppConfig>,
        log_file_path: PathBuf,
        db: &DatabaseConnection,
        timezone: chrono_tz::Tz,
        lp_application_job: JobStorage<LpApplicationJob>,
        mp_application_job: JobStorage<MpApplicationJob>,
        hp_application_job: JobStorage<HpApplicationJob>,
        single_application_jobs: Vec<JobStorage<SingleApplicationJob>>,
    ) -> Self {
        Self {
            config,
            timezone,
            log_file_path,
            db: db.clone(),
            lp_application_job,
            mp_application_job,
            hp_application_job,
            single_application_jobs,
            server_start_time: Utc::now(),
        }
    }

    pub async fn perform_application_job(&self, job: ApplicationJob) -> Result<()> {
        match job {
            ApplicationJob::Lp(job) => self.lp_application_job.clone().push(job).await?,
            ApplicationJob::Hp(job) => self.hp_application_job.clone().push(job).await?,
            ApplicationJob::Mp(job) => self.mp_application_job.clone().push(job).await?,
            ApplicationJob::Single(job) => {
                if self.single_application_jobs.is_empty() {
                    return Err(anyhow!("No single application job shards configured"));
                }
                let shard_idx =
                    single_application_job_shard_index(&job, self.single_application_jobs.len());
                self.single_application_jobs[shard_idx]
                    .clone()
                    .push(job)
                    .await?
            }
        }
        Ok(())
    }
}
