use std::collections::HashSet;

use async_graphql::Result;
use database_models::{metadata, prelude::Metadata, user};
use database_utils::get_user_query;
use dependent_models::{ApplicationCacheKey, ApplicationCacheValue, TrendingMetadataIdsResponse};
use dependent_utils::{
    commit_metadata, get_metadata_provider, get_users_monitoring_entity, send_notification_for_user,
};
use enum_meta::Meta;
use enum_models::{MediaLot, UserNotificationContent};
use itertools::Itertools;
use media_models::ReviewPostedEvent;
use sea_orm::{ColumnTrait, EntityTrait, Iterable, QueryFilter, QueryOrder, QuerySelect};
use sea_query::Expr;
use supporting_service::SupportingService;

pub async fn trending_metadata(
    supporting_service: &std::sync::Arc<SupportingService>,
) -> Result<TrendingMetadataIdsResponse> {
    let key = ApplicationCacheKey::TrendingMetadataIds;
    let (_id, cached) = 'calc: {
        if let Some(x) = supporting_service
            .cache_service
            .get_value::<TrendingMetadataIdsResponse>(key)
            .await
        {
            break 'calc x;
        }
        let mut trending_ids = HashSet::new();
        let provider_configs = MediaLot::iter()
            .flat_map(|lot| lot.meta().into_iter().map(move |source| (lot, source)));

        for (lot, source) in provider_configs {
            let provider = match get_metadata_provider(lot, source, supporting_service).await {
                Ok(p) => p,
                Err(_) => continue,
            };
            let media = match provider.get_trending_media().await {
                Ok(m) => m,
                Err(_) => continue,
            };
            for item in media {
                if let Ok(metadata) = commit_metadata(item, supporting_service).await {
                    trending_ids.insert(metadata.id);
                }
            }
        }

        let vec = trending_ids.into_iter().collect_vec();
        let id = supporting_service
            .cache_service
            .set_key(
                ApplicationCacheKey::TrendingMetadataIds,
                ApplicationCacheValue::TrendingMetadataIds(vec.clone()),
            )
            .await?;
        (id, vec)
    };
    let actually_in_db = Metadata::find()
        .select_only()
        .column(metadata::Column::Id)
        .filter(metadata::Column::Id.is_in(cached))
        .order_by_desc(metadata::Column::LastUpdatedOn)
        .into_tuple::<String>()
        .all(&supporting_service.db)
        .await?;
    Ok(actually_in_db)
}

pub async fn handle_review_posted_event(
    service: &crate::MiscellaneousService,
    supporting_service: &std::sync::Arc<SupportingService>,
    event: ReviewPostedEvent,
) -> Result<()> {
    let monitored_by =
        get_users_monitoring_entity(&event.obj_id, event.entity_lot, &supporting_service.db)
            .await?;
    let users = get_user_query()
        .select_only()
        .column(user::Column::Id)
        .filter(user::Column::Id.is_in(monitored_by))
        .filter(Expr::cust(format!(
            "(preferences -> 'notifications' -> 'to_send' ? '{}') = true",
            UserNotificationContent::ReviewPosted
        )))
        .into_tuple::<String>()
        .all(&supporting_service.db)
        .await?;
    for user_id in users {
        let url = service.get_entity_details_frontend_url(
            event.obj_id.clone(),
            event.entity_lot,
            Some("reviews"),
        );
        send_notification_for_user(
            &user_id,
            supporting_service,
            &(
                format!(
                    "New review posted for {} ({}, {}) by {}.",
                    event.obj_title, event.entity_lot, url, event.username
                ),
                UserNotificationContent::ReviewPosted,
            ),
        )
        .await?;
    }
    Ok(())
}
