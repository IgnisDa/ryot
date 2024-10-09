use std::sync::Arc;

use apalis::prelude::MemoryStorage;
use background::{ApplicationJob, CoreApplicationJob};
use cache_service::CacheService;
use file_storage_service::FileStorageService;
use media_models::CommitCache;
use moka::future::Cache;
use openidconnect::core::CoreClient;
use sea_orm::DatabaseConnection;

pub struct SupportingService {
    pub is_pro: bool,
    pub db: DatabaseConnection,
    pub timezone: chrono_tz::Tz,
    pub cache_service: CacheService,
    pub config: Arc<config::AppConfig>,
    pub oidc_client: Option<CoreClient>,
    pub commit_cache: Cache<CommitCache, ()>,
    pub file_storage_service: Arc<FileStorageService>,
    pub perform_application_job: MemoryStorage<ApplicationJob>,
    pub perform_core_application_job: MemoryStorage<CoreApplicationJob>,
}

impl SupportingService {
    #[allow(clippy::too_many_arguments)]
    pub async fn new(
        is_pro: bool,
        db: &DatabaseConnection,
        timezone: chrono_tz::Tz,
        cache_service: CacheService,
        config: Arc<config::AppConfig>,
        oidc_client: Option<CoreClient>,
        commit_cache: Cache<CommitCache, ()>,
        file_storage_service: Arc<FileStorageService>,
        perform_application_job: &MemoryStorage<ApplicationJob>,
        perform_core_application_job: &MemoryStorage<CoreApplicationJob>,
    ) -> Self {
        Self {
            config,
            is_pro,
            timezone,
            oidc_client,
            commit_cache,
            cache_service,
            db: db.clone(),
            file_storage_service,
            perform_application_job: perform_application_job.clone(),
            perform_core_application_job: perform_core_application_job.clone(),
        }
    }
}
