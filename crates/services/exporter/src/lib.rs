use std::sync::Arc;

use async_graphql::Result;
use common_models::ExportJob;
use supporting_service::SupportingService;

mod export_utilities;
mod fitness_exports;
mod job_management;
mod media_exports;

use job_management::JobManager;

pub struct ExporterService {
    job_manager: JobManager,
}

impl ExporterService {
    pub fn new(service: Arc<SupportingService>) -> Self {
        Self {
            job_manager: JobManager::new(service),
        }
    }

    pub async fn deploy_export_job(&self, user_id: String) -> Result<bool> {
        self.job_manager.deploy_export_job(user_id).await
    }

    pub async fn user_exports(&self, user_id: String) -> Result<Vec<ExportJob>> {
        self.job_manager.user_exports(user_id).await
    }

    pub async fn perform_export(&self, user_id: String) -> Result<()> {
        self.job_manager.perform_export(user_id).await
    }
}
