use std::sync::Arc;

use async_graphql::Result;
use common_models::ExportJob;
use supporting_service::SupportingService;

mod export_utilities;
mod fitness_exports;
mod job_management;
mod media_exports;

use job_management::JobManager;

pub struct ExporterService(pub Arc<SupportingService>);

impl ExporterService {
    pub async fn deploy_export_job(&self, user_id: String) -> Result<bool> {
        let job_manager = JobManager::new(self.0.clone());
        job_manager.deploy_export_job(user_id).await
    }

    pub async fn user_exports(&self, user_id: String) -> Result<Vec<ExportJob>> {
        let job_manager = JobManager::new(self.0.clone());
        job_manager.user_exports(user_id).await
    }

    pub async fn perform_export(&self, user_id: String) -> Result<()> {
        let job_manager = JobManager::new(self.0.clone());
        job_manager.perform_export(user_id).await
    }
}
