use std::{collections::HashSet, sync::Arc};

use anyhow::Result;
use database_models::{metadata, prelude::Metadata};
use dependent_models::{ApplicationCacheKey, ApplicationCacheValue, TrendingMetadataIdsResponse};
use dependent_utils::{
    commit_metadata, get_metadata_provider, get_users_monitoring_entity, send_notification_for_user,
};
use enum_meta::Meta;
use enum_models::{MediaLot, UserNotificationContent};
use itertools::Itertools;
use media_models::ReviewPostedEvent;
use sea_orm::{ColumnTrait, EntityTrait, Iterable, QueryFilter, QueryOrder, QuerySelect};
use supporting_service::SupportingService;

pub async fn trending_metadata(ss: &Arc<SupportingService>) -> Result<TrendingMetadataIdsResponse> {
    let key = ApplicationCacheKey::TrendingMetadataIds;
    let cached_response = cache_service::get_or_set_with_callback(
        ss,
        key,
        ApplicationCacheValue::TrendingMetadataIds,
        || async {
            let mut trending_ids = HashSet::new();
            let provider_configs = MediaLot::iter()
                .flat_map(|lot| lot.meta().into_iter().map(move |source| (lot, source)));

            for (lot, source) in provider_configs {
                let provider = match get_metadata_provider(lot, source, ss).await {
                    Ok(p) => p,
                    Err(_) => continue,
                };
                let media = match provider.get_trending_media().await {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                for item in media {
                    if let Ok((metadata, _)) = commit_metadata(item, ss, None).await {
                        trending_ids.insert(metadata.id);
                    }
                }
            }

            let vec = trending_ids.into_iter().collect_vec();
            Ok(vec)
        },
    )
    .await?;
    let (_id, cached) = (cached_response.cache_id, cached_response.response);
    let actually_in_db = Metadata::find()
        .select_only()
        .column(metadata::Column::Id)
        .filter(metadata::Column::Id.is_in(cached))
        .order_by_desc(metadata::Column::LastUpdatedOn)
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    Ok(actually_in_db)
}

pub async fn handle_review_posted_event(
    ss: &Arc<SupportingService>,
    event: ReviewPostedEvent,
) -> Result<()> {
    let monitored_by = get_users_monitoring_entity(&event.obj_id, event.entity_lot, &ss.db).await?;
    for user_id in monitored_by {
        send_notification_for_user(
            &user_id,
            ss,
            UserNotificationContent::ReviewPosted {
                entity_lot: event.entity_lot,
                entity_id: event.obj_id.clone(),
                entity_title: event.obj_title.clone(),
                triggered_by_username: event.username.clone(),
            },
        )
        .await?;
    }
    Ok(())
}
