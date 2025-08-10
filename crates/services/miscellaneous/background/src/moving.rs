use std::sync::Arc;

use anyhow::Result;
use common_utils::ryot_log;
use supporting_service::SupportingService;

pub async fn move_metadata_between_collections(ss: &Arc<SupportingService>) -> Result<()> {
    ryot_log!(trace, "Moving items between collections");
    Ok(())
}
