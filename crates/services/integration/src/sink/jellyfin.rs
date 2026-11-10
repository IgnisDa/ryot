use std::sync::Arc;

use anyhow::Result;
use dependent_models::ImportResult;
use supporting_service::SupportingService;

use super::jellyfin_official;

pub async fn sink_progress(
    payload: String,
    jellyfin_sink_username: Option<String>,
    jellyfin_sink_metadata_provider: Option<String>,
    ss: &Arc<SupportingService>,
) -> Result<Option<ImportResult>> {
    jellyfin_official::sink_progress_official(
        payload,
        jellyfin_sink_username,
        jellyfin_sink_metadata_provider,
        ss,
    )
    .await
}
