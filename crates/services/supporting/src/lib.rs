use std::sync::Arc;

use anyhow::Result;
use apalis::prelude::{MemoryStorage, MessageQueue};
use background_models::{ApplicationJob, HpApplicationJob, LpApplicationJob, MpApplicationJob};
use bon::bon;
use cache_service::CacheService;
use chrono::{NaiveDate, TimeZone, Utc};
use common_utils::{COMPILATION_TIMESTAMP, convert_naive_to_utc, ryot_log};
use env_utils::UNKEY_API_ID;
use file_storage_service::FileStorageService;
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use unkey::{Client, models::VerifyKeyRequest};

pub struct SupportingService {
    pub is_oidc_enabled: bool,
    pub db: DatabaseConnection,
    pub timezone: chrono_tz::Tz,
    pub cache_service: CacheService,
    pub config: Arc<config::AppConfig>,
    pub file_storage_service: Arc<FileStorageService>,

    lp_application_job: MemoryStorage<LpApplicationJob>,
    hp_application_job: MemoryStorage<HpApplicationJob>,
    mp_application_job: MemoryStorage<MpApplicationJob>,
}

#[bon]
impl SupportingService {
    #[builder]
    pub async fn new(
        is_oidc_enabled: bool,
        db: &DatabaseConnection,
        timezone: chrono_tz::Tz,
        cache_service: CacheService,
        config: Arc<config::AppConfig>,
        file_storage_service: Arc<FileStorageService>,
        lp_application_job: &MemoryStorage<LpApplicationJob>,
        mp_application_job: &MemoryStorage<MpApplicationJob>,
        hp_application_job: &MemoryStorage<HpApplicationJob>,
    ) -> Self {
        Self {
            config,
            timezone,
            cache_service,
            db: db.clone(),
            is_oidc_enabled,
            file_storage_service,
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

    pub async fn get_is_server_key_validated(&self) -> bool {
        let pro_key = &self.config.server.pro_key;
        if pro_key.is_empty() {
            return false;
        }
        ryot_log!(debug, "Verifying pro key for API ID: {:#?}", UNKEY_API_ID);
        let compile_timestamp = Utc.timestamp_opt(COMPILATION_TIMESTAMP, 0).unwrap();
        #[derive(Debug, Serialize, Clone, Deserialize)]
        struct Meta {
            expiry: Option<NaiveDate>,
        }
        let unkey_client = Client::new("public");
        let verify_request = VerifyKeyRequest::new(pro_key, &UNKEY_API_ID.to_string());
        let validated_key = match unkey_client.verify_key(verify_request).await {
            Ok(verify_response) => {
                if !verify_response.valid {
                    ryot_log!(debug, "Pro key is no longer valid.");
                    return false;
                }
                verify_response
            }
            Err(verify_error) => {
                ryot_log!(debug, "Pro key verification error: {:?}", verify_error);
                return false;
            }
        };
        let key_meta = validated_key
            .meta
            .map(|meta| serde_json::from_value::<Meta>(meta).unwrap());
        ryot_log!(debug, "Expiry: {:?}", key_meta.clone().map(|m| m.expiry));
        if let Some(meta) = key_meta {
            if let Some(expiry) = meta.expiry {
                if compile_timestamp > convert_naive_to_utc(expiry) {
                    ryot_log!(warn, "Pro key has expired. Please renew your subscription.");
                    return false;
                }
            }
        }
        ryot_log!(debug, "Pro key verified successfully");
        true
    }
}
