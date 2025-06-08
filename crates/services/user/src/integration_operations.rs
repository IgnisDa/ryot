use std::sync::Arc;

use async_graphql::{Error, Result};
use database_models::prelude::Integration;
use sea_orm::{EntityTrait, ModelTrait};
use supporting_service::SupportingService;

pub async fn delete_user_integration(
    supporting_service: &Arc<SupportingService>,
    user_id: String,
    integration_id: String,
) -> Result<bool> {
    let integration = Integration::find_by_id(integration_id)
        .one(&supporting_service.db)
        .await?
        .ok_or_else(|| Error::new("Integration with the given id does not exist"))?;
    if integration.user_id != user_id {
        return Err(Error::new("Integration does not belong to the user"));
    }
    integration.delete(&supporting_service.db).await?;
    Ok(true)
}
