use std::sync::Arc;

use anyhow::Result;
use database_utils::user_by_id;
use dependent_models::ApplicationCacheKeyDiscriminants;
use futures::future::try_join_all;
use sea_orm::{ActiveModelTrait, ActiveValue, IntoActiveModel};
use supporting_service::SupportingService;
use user_models::UserPreferences;

pub async fn update_user_preference(
    ss: &Arc<SupportingService>,
    user_id: &String,
    input: UserPreferences,
) -> Result<bool> {
    let user_model = user_by_id(user_id, ss).await?;
    let mut user_model = user_model.into_active_model();
    user_model.preferences = ActiveValue::Set(input);
    user_model.update(&ss.db).await?;
    let cache_keys = vec![
        ApplicationCacheKeyDiscriminants::PersonDetails,
        ApplicationCacheKeyDiscriminants::MetadataDetails,
        ApplicationCacheKeyDiscriminants::UserPersonDetails,
        ApplicationCacheKeyDiscriminants::UserMetadataDetails,
        ApplicationCacheKeyDiscriminants::MetadataGroupDetails,
        ApplicationCacheKeyDiscriminants::UserMetadataGroupDetails,
    ];
    try_join_all(cache_keys.into_iter().map(|key| {
        cache_service::expire_key(
            ss,
            dependent_models::ExpireCacheKeyInput::BySanitizedKey {
                key,
                user_id: Some(user_id.to_owned()),
            },
        )
    }))
    .await?;
    Ok(true)
}
