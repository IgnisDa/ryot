use std::sync::Arc;

use apalis::prelude::{MemoryStorage, MessageQueue};
use async_graphql::Result;
use background::{ApplicationJob, CoreApplicationJob};
use cache_service::CacheService;
use common_models::ApplicationCacheKey;
use dependent_models::EmptyCacheValue;
use file_storage_service::FileStorageService;
use openidconnect::core::CoreClient;
use sea_orm::DatabaseConnection;

pub struct SupportingService {
    pub db: DatabaseConnection,
    pub timezone: chrono_tz::Tz,
    pub cache_service: CacheService,
    pub config: Arc<config::AppConfig>,
    pub oidc_client: Option<CoreClient>,
    pub file_storage_service: Arc<FileStorageService>,

    perform_application_job: MemoryStorage<ApplicationJob>,
    perform_core_application_job: MemoryStorage<CoreApplicationJob>,
}

impl SupportingService {
    #[allow(clippy::too_many_arguments)]
    pub async fn new(
        db: &DatabaseConnection,
        timezone: chrono_tz::Tz,
        cache_service: CacheService,
        config: Arc<config::AppConfig>,
        oidc_client: Option<CoreClient>,
        file_storage_service: Arc<FileStorageService>,
        perform_application_job: &MemoryStorage<ApplicationJob>,
        perform_core_application_job: &MemoryStorage<CoreApplicationJob>,
    ) -> Self {
        Self {
            config,
            timezone,
            oidc_client,
            cache_service,
            db: db.clone(),
            file_storage_service,
            perform_application_job: perform_application_job.clone(),
            perform_core_application_job: perform_core_application_job.clone(),
        }
    }

    pub async fn perform_application_job(&self, job: ApplicationJob) -> Result<()> {
        self.perform_application_job
            .clone()
            .enqueue(job)
            .await
            .unwrap();
        Ok(())
    }

    pub async fn perform_core_application_job(&self, job: CoreApplicationJob) -> Result<()> {
        self.perform_core_application_job
            .clone()
            .enqueue(job)
            .await
            .unwrap();
        Ok(())
    }

    pub async fn is_server_key_validated(&self) -> Result<bool> {
        self.cache_service
            .get_value::<EmptyCacheValue>(ApplicationCacheKey::ServerKeyValidated)
            .await
            .map(|v| v.is_some())
    }
}
