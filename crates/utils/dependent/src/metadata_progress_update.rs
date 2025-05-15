use std::sync::Arc;

use async_graphql::Result;
use media_models::MetadataProgressUpdateInput;
use supporting_service::SupportingService;

pub async fn metadata_progress_update(
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: MetadataProgressUpdateInput,
) -> Result<()> {
    dbg!(&input);
    Ok(())
}
