use std::sync::Arc;

use anyhow::Result;
use common_models::UserLevelCacheKey;
use database_models::user;
use database_utils::get_enabled_users_query;
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheKeyDiscriminants, ExpireCacheKeyInput,
};
use futures::{StreamExt, stream};
use sea_orm::QuerySelect;
use supporting_service::SupportingService;

pub async fn expire_cache_keys(ss: &Arc<SupportingService>) -> Result<()> {
    let mut all_keys = vec![];
    let user_ids = get_enabled_users_query()
        .select_only()
        .column(user::Column::Id)
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    for user_id in user_ids {
        all_keys.push(ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(user_id.clone()),
            key: ApplicationCacheKeyDiscriminants::UserMetadataRecommendationsSet,
        });
        all_keys.push(ExpireCacheKeyInput::ByKey(Box::new(
            ApplicationCacheKey::UserMetadataRecommendationsSet(UserLevelCacheKey {
                input: (),
                user_id: user_id.clone(),
            }),
        )));
    }
    all_keys.push(ExpireCacheKeyInput::ByKey(Box::new(
        ApplicationCacheKey::TrendingMetadataIds,
    )));

    for key in all_keys {
        cache_service::expire_key(ss, key).await?;
    }
    Ok(())
}

pub async fn remove_cached_metadata_after_updates(ss: &Arc<SupportingService>) -> Result<()> {
    let user_ids: Vec<String> = get_enabled_users_query()
        .select_only()
        .column(user::Column::Id)
        .into_tuple()
        .all(&ss.db)
        .await?;

    let user_cache_operations: Vec<_> = user_ids
        .iter()
        .flat_map(|user_id| {
            vec![
                (
                    user_id.clone(),
                    ApplicationCacheKeyDiscriminants::UserMetadataRecommendationsSet,
                ),
                (
                    user_id.clone(),
                    ApplicationCacheKeyDiscriminants::UserMetadataRecommendations,
                ),
            ]
        })
        .collect();

    let _results: Vec<_> = stream::iter(user_cache_operations)
        .map(|(user_id, cache_key)| async move {
            cache_service::expire_key(
                ss,
                ExpireCacheKeyInput::BySanitizedKey {
                    key: cache_key,
                    user_id: Some(user_id),
                },
            )
            .await
        })
        .buffer_unordered(5)
        .collect()
        .await;

    cache_service::expire_key(
        ss,
        ExpireCacheKeyInput::BySanitizedKey {
            user_id: None,
            key: ApplicationCacheKeyDiscriminants::CollectionRecommendations,
        },
    )
    .await?;

    Ok(())
}
