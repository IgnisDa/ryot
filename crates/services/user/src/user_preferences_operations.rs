use std::sync::Arc;

use anyhow::Result;
use database_utils::user_by_id;
use sea_orm::{ActiveModelTrait, ActiveValue};
use supporting_service::SupportingService;
use user_models::UserPreferences;

pub async fn update_user_preference(
    ss: &Arc<SupportingService>,
    user_id: &String,
    input: UserPreferences,
) -> Result<bool> {
    let user_model = user_by_id(user_id, ss).await?;
    let mut user_model: database_models::user::ActiveModel = user_model.into();
    user_model.preferences = ActiveValue::Set(input);
    user_model.update(&ss.db).await?;
    Ok(true)
}
