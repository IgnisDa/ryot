use std::sync::Arc;

use anyhow::Result;
use chrono::Utc;
use common_utils::ryot_log;
use database_models::{
    collection_to_entity, monitored_entity, notification_platform,
    prelude::{CollectionToEntity, MonitoredEntity, NotificationPlatform},
};
use enum_models::{EntityLot, UserNotificationContent};
use itertools::Itertools;
use media_models::UpdateMediaEntityResult;
use notification_service::send_notification;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QuerySelect};
use sea_query::Expr;
use supporting_service::SupportingService;
use traits::TraceOk;
use uuid::Uuid;

use crate::metadata_operations;

pub async fn get_users_and_cte_monitoring_entity(
    entity_id: &String,
    entity_lot: EntityLot,
    db: &DatabaseConnection,
) -> Result<Vec<(String, Uuid)>> {
    let all_entities = MonitoredEntity::find()
        .select_only()
        .column(monitored_entity::Column::UserId)
        .column(monitored_entity::Column::CollectionToEntityId)
        .filter(monitored_entity::Column::EntityId.eq(entity_id))
        .filter(monitored_entity::Column::EntityLot.eq(entity_lot))
        .into_tuple::<(String, Uuid)>()
        .all(db)
        .await?;
    Ok(all_entities)
}

pub async fn get_users_monitoring_entity(
    entity_id: &String,
    entity_lot: EntityLot,
    db: &DatabaseConnection,
) -> Result<Vec<String>> {
    Ok(
        get_users_and_cte_monitoring_entity(entity_id, entity_lot, db)
            .await?
            .into_iter()
            .map(|(u, _)| u)
            .collect_vec(),
    )
}

pub async fn send_notification_for_user(
    user_id: &String,
    ss: &Arc<SupportingService>,
    (msg, change): &(String, UserNotificationContent),
) -> Result<()> {
    let notification_platforms = NotificationPlatform::find()
        .filter(notification_platform::Column::UserId.eq(user_id))
        .filter(
            notification_platform::Column::IsDisabled
                .is_null()
                .or(notification_platform::Column::IsDisabled.eq(false)),
        )
        .all(&ss.db)
        .await?;
    for platform in notification_platforms {
        if !platform.configured_events.contains(change) {
            ryot_log!(
                debug,
                "Skipping sending notification to user: {} for platform: {} since it is not configured for this event",
                user_id,
                platform.lot,
            );
            continue;
        }
        if let Err(err) = send_notification(platform.platform_specifics, msg).await {
            ryot_log!(trace, "Error sending notification: {:?}", err);
        }
    }
    Ok(())
}

pub async fn refresh_collection_to_entity_association(
    cte_id: &Uuid,
    db: &DatabaseConnection,
) -> Result<()> {
    ryot_log!(
        debug,
        "Refreshing collection to entity association for id = {cte_id}"
    );
    CollectionToEntity::update_many()
        .col_expr(
            collection_to_entity::Column::LastUpdatedOn,
            Expr::value(Utc::now()),
        )
        .filter(collection_to_entity::Column::Id.eq(cte_id.to_owned()))
        .exec(db)
        .await?;
    Ok(())
}

pub async fn update_metadata_and_notify_users(
    metadata_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<UpdateMediaEntityResult> {
    let result = metadata_operations::update_metadata(metadata_id, ss).await?;
    if !result.notifications.is_empty() {
        let users_to_notify =
            get_users_and_cte_monitoring_entity(metadata_id, EntityLot::Metadata, &ss.db).await?;
        for notification in result.notifications.iter() {
            for (user_id, cte_id) in users_to_notify.iter() {
                send_notification_for_user(user_id, ss, notification)
                    .await
                    .trace_ok();
                refresh_collection_to_entity_association(cte_id, &ss.db)
                    .await
                    .trace_ok();
            }
        }
    }
    Ok(result)
}

pub async fn update_person_and_notify_users(
    person_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<UpdateMediaEntityResult> {
    let result = metadata_operations::update_person(person_id.clone(), ss).await?;
    if !result.notifications.is_empty() {
        let users_to_notify =
            get_users_and_cte_monitoring_entity(person_id, EntityLot::Person, &ss.db).await?;
        for notification in result.notifications.iter() {
            for (user_id, cte_id) in users_to_notify.iter() {
                send_notification_for_user(user_id, ss, notification)
                    .await
                    .trace_ok();
                refresh_collection_to_entity_association(cte_id, &ss.db)
                    .await
                    .trace_ok();
            }
        }
    }
    Ok(result)
}

pub async fn update_metadata_group_and_notify_users(
    metadata_group_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<UpdateMediaEntityResult> {
    let result = metadata_operations::update_metadata_group(metadata_group_id, ss).await?;
    if !result.notifications.is_empty() {
        let users_to_notify = get_users_and_cte_monitoring_entity(
            metadata_group_id,
            EntityLot::MetadataGroup,
            &ss.db,
        )
        .await?;
        for notification in result.notifications.iter() {
            for (user_id, cte_id) in users_to_notify.iter() {
                send_notification_for_user(user_id, ss, notification)
                    .await
                    .trace_ok();
                refresh_collection_to_entity_association(cte_id, &ss.db)
                    .await
                    .trace_ok();
            }
        }
    }
    Ok(result)
}
