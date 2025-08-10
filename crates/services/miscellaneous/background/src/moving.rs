use std::sync::Arc;

use anyhow::Result;
use enum_models::EntityLot;
use supporting_service::SupportingService;

use crate::monitoring::get_monitored_entities;

pub async fn move_metadata_between_collections(ss: &Arc<SupportingService>) -> Result<()> {
    let metadata_entities = get_monitored_entities(EntityLot::Metadata, ss).await?;
    Ok(())
}
