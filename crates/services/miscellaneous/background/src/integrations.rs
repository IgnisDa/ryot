use std::sync::Arc;

use anyhow::Result;
use background_models::{ApplicationJob, MpApplicationJob};
use supporting_service::SupportingService;

pub async fn sync_integrations_data_to_owned_collection(ss: &Arc<SupportingService>) -> Result<()> {
    ss.perform_application_job(ApplicationJob::Mp(MpApplicationJob::SyncIntegrationsData))
        .await?;
    Ok(())
}
