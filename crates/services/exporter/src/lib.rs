use std::sync::Arc;

use async_graphql::Result;
use common_models::ExportJob;
use supporting_service::SupportingService;

mod collection_exports;
mod export_operations;
mod export_utilities;
mod fitness_exports;
mod media_exports;

use export_operations::{deploy_export_job, perform_export, user_exports};

pub struct ExporterService(pub Arc<SupportingService>);

impl ExporterService {
    pub async fn deploy_export_job(&self, user_id: String) -> Result<bool> {
        deploy_export_job(&self.0, user_id).await
    }

    pub async fn user_exports(&self, user_id: String) -> Result<Vec<ExportJob>> {
        user_exports(&self.0, user_id).await
    }

    pub async fn perform_export(&self, user_id: String) -> Result<()> {
        perform_export(&self.0, user_id).await
    }
}
