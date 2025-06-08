use std::sync::Arc;

use async_graphql::Result;
use common_models::StringIdObject;
use database_models::access_link;
use database_utils::server_key_validation_guard;
use media_models::CreateAccessLinkInput;
use sea_orm::{ActiveModelTrait, ActiveValue};
use supporting_service::SupportingService;

pub async fn create_access_link(
    supporting_service: &Arc<SupportingService>,
    input: CreateAccessLinkInput,
    user_id: String,
) -> Result<StringIdObject> {
    server_key_validation_guard(supporting_service.is_server_key_validated().await?).await?;
    let new_link = access_link::ActiveModel {
        user_id: ActiveValue::Set(user_id),
        name: ActiveValue::Set(input.name),
        expires_on: ActiveValue::Set(input.expires_on),
        redirect_to: ActiveValue::Set(input.redirect_to),
        maximum_uses: ActiveValue::Set(input.maximum_uses),
        is_account_default: ActiveValue::Set(input.is_account_default),
        is_mutation_allowed: ActiveValue::Set(input.is_mutation_allowed),
        ..Default::default()
    };
    let link = new_link.insert(&supporting_service.db).await?;
    Ok(StringIdObject { id: link.id })
}
