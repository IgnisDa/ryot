use std::{collections::HashSet, sync::Arc};

use async_graphql::Result;
use database_models::{metadata, prelude::Metadata, user};
use database_utils::get_enabled_users_query;
use dependent_models::{ApplicationCacheKey, ApplicationCacheValue, TrendingMetadataIdsResponse};
use dependent_utils::{
    commit_metadata, get_metadata_provider, get_users_monitoring_entity, send_notification_for_user,
};
use enum_meta::Meta;
use enum_models::{EntityLot, MediaLot, UserNotificationContent};
use itertools::Itertools;
use media_models::ReviewPostedEvent;
use sea_orm::{ColumnTrait, EntityTrait, Iterable, QueryFilter, QueryOrder, QuerySelect};
use sea_query::Expr;
use supporting_service::SupportingService;

pub async fn trending_metadata(ss: &Arc<SupportingService>) -> Result<TrendingMetadataIdsResponse> {
    let key = ApplicationCacheKey::TrendingMetadataIds;
    let (_id, cached) = 'calc: {
        if let Some(x) = ss
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
        let id = ss
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
        .order_by_desc(metadata::Column::Title)
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    Ok(actually_in_db)
}

pub fn get_entity_details_frontend_url(
    id: String,
    entity_lot: EntityLot,
    default_tab: Option<&str>,
    ss: &Arc<SupportingService>,
) -> String {
    let mut url = match entity_lot {
        EntityLot::Metadata => format!("media/item/{}", id),
        EntityLot::Collection => format!("collections/{}", id),
        EntityLot::Person => format!("media/people/item/{}", id),
        EntityLot::Workout => format!("fitness/workouts/{}", id),
        EntityLot::Exercise => format!("fitness/exercises/{}", id),
        EntityLot::MetadataGroup => format!("media/groups/item/{}", id),
        EntityLot::WorkoutTemplate => format!("fitness/templates/{}", id),
        EntityLot::Review | EntityLot::UserMeasurement => unreachable!(),
    };
    url = format!("{}/{}", ss.config.frontend.url, url);
    if let Some(tab) = default_tab {
        url += format!("?defaultTab={}", tab).as_str()
    }
    url
}

pub async fn handle_review_posted_event(
    ss: &Arc<SupportingService>,
    event: ReviewPostedEvent,
) -> Result<()> {
    let monitored_by = get_users_monitoring_entity(&event.obj_id, event.entity_lot, &ss.db).await?;
    let users = get_enabled_users_query()
        .select_only()
        .column(user::Column::Id)
        .filter(user::Column::Id.is_in(monitored_by))
        .filter(Expr::cust(format!(
            "(preferences -> 'notifications' -> 'to_send' ? '{}') = true",
            UserNotificationContent::ReviewPosted
        )))
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    for user_id in users {
        let url = get_entity_details_frontend_url(
            event.obj_id.clone(),
            event.entity_lot,
            Some("reviews"),
            ss,
        );
        send_notification_for_user(
            &user_id,
            ss,
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
