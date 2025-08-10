use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use anyhow::Result;
use common_utils::{BULK_APPLICATION_UPDATE_CHUNK_SIZE, ryot_log};
use database_models::{monitored_entity, prelude::MonitoredEntity};
use dependent_notification_utils::{
    update_metadata_and_notify_users, update_person_and_notify_users,
};
use enum_models::EntityLot;
use futures::future::join_all;
use itertools::Itertools;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use supporting_service::SupportingService;

pub async fn get_monitored_entities(
    entity_lot: EntityLot,
    ss: &Arc<SupportingService>,
) -> Result<HashMap<String, HashSet<String>>> {
    let monitored_entities = MonitoredEntity::find()
        .filter(monitored_entity::Column::EntityLot.eq(entity_lot))
        .all(&ss.db)
        .await?;
    let mut monitored_by = HashMap::new();
    for entity in monitored_entities {
        let user_ids = monitored_by
            .entry(entity.entity_id)
            .or_insert(HashSet::new());
        user_ids.insert(entity.user_id);
    }
    Ok(monitored_by)
}

pub async fn update_monitored_metadata_and_queue_notifications(
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let m_map = get_monitored_entities(EntityLot::Metadata, ss).await?;
    ryot_log!(
        debug,
        "Users to be notified for metadata state changes: {:?}",
        m_map
    );
    let chunks = m_map.keys().chunks(BULK_APPLICATION_UPDATE_CHUNK_SIZE);
    let items = chunks
        .into_iter()
        .map(|chunk| chunk.into_iter().collect_vec())
        .collect_vec();
    for chunk in items {
        let promises = chunk
            .into_iter()
            .map(|m| update_metadata_and_notify_users(m, ss));
        join_all(promises).await;
    }
    Ok(())
}

pub async fn update_monitored_people_and_queue_notifications(
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let p_map = get_monitored_entities(EntityLot::Person, ss).await?;
    ryot_log!(
        debug,
        "Users to be notified for people state changes: {:?}",
        p_map
    );
    let chunks = p_map.keys().chunks(BULK_APPLICATION_UPDATE_CHUNK_SIZE);
    let items = chunks
        .into_iter()
        .map(|chunk| chunk.into_iter().collect_vec())
        .collect_vec();
    for chunk in items {
        let promises = chunk
            .into_iter()
            .map(|p| update_person_and_notify_users(p, ss));
        join_all(promises).await;
    }
    Ok(())
}
