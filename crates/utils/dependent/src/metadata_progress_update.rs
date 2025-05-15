use std::sync::Arc;

use async_graphql::{Error, Result};
use database_models::{metadata::Model, prelude::Metadata};
use media_models::{
    MetadataProgressUpdateChange, MetadataProgressUpdateChangeCreateNewInput,
    MetadataProgressUpdateCommonInput, MetadataProgressUpdateInput,
};
use sea_orm::EntityTrait;
use supporting_service::SupportingService;

async fn create_new_without_dates(
    meta: &Model,
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: MetadataProgressUpdateCommonInput,
) -> Result<()> {
    dbg!(meta, user_id, input);
    Ok(())
}

pub async fn metadata_progress_update(
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: MetadataProgressUpdateInput,
) -> Result<()> {
    let meta = Metadata::find_by_id(&input.metadata_id)
        .one(&ss.db)
        .await?
        .ok_or_else(|| Error::new("Metadata not found"))?;
    match input.change {
        MetadataProgressUpdateChange::CreateNew(create_new_input) => match create_new_input {
            MetadataProgressUpdateChangeCreateNewInput::WithoutDates(inner_input) => {
                create_new_without_dates(&meta, user_id, ss, inner_input).await?;
            }
            _ => todo!(),
        },
        _ => todo!(),
    }
    Ok(())
}
