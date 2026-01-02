use std::sync::Arc;

use anyhow::Result;
use database_utils::user_by_id;
use dependent_models::{ApplicationCacheKeyDiscriminants, ExpireCacheKeyInput};
use sea_orm::{ActiveModelTrait, ActiveValue, IntoActiveModel};
use supporting_service::SupportingService;
use user_models::UserPreferences;

pub async fn update_user_preference(
    ss: &Arc<SupportingService>,
    user_id: &String,
    input: UserPreferences,
) -> Result<bool> {
    let user_model = user_by_id(user_id, ss).await?;

    let new_language_preferences = input.languages.clone();
    let old_language_preferences = user_model.preferences.languages.clone();

    let mut user_model = user_model.into_active_model();
    user_model.preferences = ActiveValue::Set(input);
    user_model.update(&ss.db).await?;

    if old_language_preferences != new_language_preferences {
        cache_service::expire_key(
            ss,
            ExpireCacheKeyInput::BySanitizedKey {
                user_id: Some(user_id.clone()),
                key: ApplicationCacheKeyDiscriminants::UserEntityTranslations,
            },
        )
        .await?;
    }

    Ok(true)
}
