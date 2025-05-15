use std::sync::Arc;

use async_graphql::Result;
use media_models::{
    MetadataProgressUpdateChange, MetadataProgressUpdateChangeCreateNewInput,
    MetadataProgressUpdateCommonInput, MetadataProgressUpdateInput,
};
use supporting_service::SupportingService;

async fn create_new_without_dates(
    user_id: &String,
    metadata_id: &String,
    ss: &Arc<SupportingService>,
    input: MetadataProgressUpdateCommonInput,
) -> Result<()> {
    dbg!(user_id, metadata_id, &input);
    Ok(())
}

pub async fn metadata_progress_update(
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: MetadataProgressUpdateInput,
) -> Result<()> {
    match input.change {
        MetadataProgressUpdateChange::CreateNew(create_new_input) => match create_new_input {
            MetadataProgressUpdateChangeCreateNewInput::WithoutDates(inner_input) => {
                create_new_without_dates(user_id, &input.metadata_id, ss, inner_input).await?;
            }
            _ => todo!(),
        },
        _ => todo!(),
    }
    Ok(())
}
