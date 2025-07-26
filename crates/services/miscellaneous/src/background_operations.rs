use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use anyhow::Result;
use background_models::{ApplicationJob, MpApplicationJob};
use chrono::{Duration, Utc};
use common_models::{DefaultCollection, UserLevelCacheKey};
use common_utils::{
    BULK_APPLICATION_UPDATE_CHUNK_SIZE, BULK_DATABASE_UPDATE_OR_DELETE_CHUNK_SIZE, ryot_log,
};
use convert_case::{Case, Casing};
use database_models::{
    access_link, application_cache, collection, collection_to_entity, genre, import_report,
    metadata, metadata_group, metadata_to_genre, monitored_entity, person,
    prelude::{
        AccessLink, ApplicationCache, Collection, CollectionToEntity, Genre, ImportReport,
        Metadata, MetadataGroup, MetadataToGenre, MonitoredEntity, Person, Seen, UserToEntity,
    },
    seen, user, user_to_entity,
};
use database_utils::{get_enabled_users_query, revoke_access_link};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheKeyDiscriminants, ExpireCacheKeyInput,
};
use dependent_utils::{
    calculate_user_activities_and_summary, get_entity_title_from_id_and_lot,
    is_server_key_validated, send_notification_for_user, update_metadata_and_notify_users,
    update_person_and_notify_users,
};
use enum_models::{EntityLot, SeenState, UserNotificationContent};
use futures::future::join_all;
use itertools::Itertools;
use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, DatabaseConnection, EntityTrait, FromQueryResult,
    ModelTrait, QueryFilter, QuerySelect, Statement, prelude::DateTimeUtc, query::UpdateMany,
};
use sea_query::Expr;
use supporting_service::SupportingService;
use traits::TraceOk;
use uuid::Uuid;

use crate::{
    calendar_operations::{
        queue_notifications_for_released_media, queue_pending_reminders,
        recalculate_calendar_events,
    },
    user_management::cleanup_user_and_metadata_association,
};

async fn get_monitored_entities(
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

async fn update_monitored_metadata_and_queue_notifications(
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

async fn update_monitored_people_and_queue_notifications(
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

pub async fn invalidate_import_jobs(ss: &Arc<SupportingService>) -> Result<()> {
    let result = ImportReport::update_many()
        .col_expr(import_report::Column::WasSuccess, Expr::value(false))
        .filter(import_report::Column::WasSuccess.is_null())
        .filter(import_report::Column::EstimatedFinishTime.lt(Utc::now()))
        .exec(&ss.db)
        .await?;
    ryot_log!(debug, "Invalidated {} import jobs", result.rows_affected);
    Ok(())
}

// FIXME: Remove this in the next major version
async fn remove_old_entities_from_monitoring_collection(ss: &Arc<SupportingService>) -> Result<()> {
    #[derive(Debug, FromQueryResult)]
    struct CustomQueryResponse {
        id: Uuid,
        entity_id: String,
        collection_id: String,
        entity_lot: EntityLot,
        last_updated_on: DateTimeUtc,
    }
    let all_cte = CollectionToEntity::find()
        .select_only()
        .column(collection_to_entity::Column::Id)
        .column(collection_to_entity::Column::EntityId)
        .column(collection_to_entity::Column::EntityLot)
        .column(collection_to_entity::Column::CollectionId)
        .column(collection_to_entity::Column::LastUpdatedOn)
        .inner_join(Collection)
        .filter(collection::Column::Name.eq(DefaultCollection::Monitoring.to_string()))
        .into_model::<CustomQueryResponse>()
        .all(&ss.db)
        .await?;
    let mut to_delete = vec![];
    for cte in all_cte {
        let delta = Utc::now() - cte.last_updated_on;
        if delta.num_days() > ss.config.media.monitoring_remove_after_days {
            to_delete.push(cte);
        }
    }
    if to_delete.is_empty() {
        return Ok(());
    }
    for item in to_delete.iter() {
        let users_in_this_collection = UserToEntity::find()
            .filter(user_to_entity::Column::CollectionId.eq(&item.collection_id))
            .all(&ss.db)
            .await?;
        let title = get_entity_title_from_id_and_lot(&item.entity_id, item.entity_lot, ss).await?;
        for user in users_in_this_collection {
            send_notification_for_user(
                &user.user_id,
                ss,
                &(
                    format!("{} has been removed from the monitoring collection", title),
                    UserNotificationContent::EntityRemovedFromMonitoringCollection,
                ),
            )
            .await?;
        }
    }
    let result = CollectionToEntity::delete_many()
        .filter(collection_to_entity::Column::Id.is_in(to_delete.into_iter().map(|c| c.id)))
        .exec(&ss.db)
        .await?;
    ryot_log!(debug, "Deleted collection to entity: {:#?}", result);
    Ok(())
}

async fn remove_useless_data(ss: &Arc<SupportingService>) -> Result<()> {
    let metadata_to_delete = Metadata::find()
        .select_only()
        .column(metadata::Column::Id)
        .left_join(UserToEntity)
        .filter(user_to_entity::Column::MetadataId.is_null())
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    for chunk in metadata_to_delete.chunks(BULK_DATABASE_UPDATE_OR_DELETE_CHUNK_SIZE) {
        ryot_log!(debug, "Deleting {} metadata items", chunk.len());
        Metadata::delete_many()
            .filter(metadata::Column::Id.is_in(chunk))
            .exec(&ss.db)
            .await
            .trace_ok();
    }
    let people_to_delete = Person::find()
        .select_only()
        .column(person::Column::Id)
        .left_join(UserToEntity)
        .filter(user_to_entity::Column::PersonId.is_null())
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    for chunk in people_to_delete.chunks(BULK_DATABASE_UPDATE_OR_DELETE_CHUNK_SIZE) {
        ryot_log!(debug, "Deleting {} people", chunk.len());
        Person::delete_many()
            .filter(person::Column::Id.is_in(chunk))
            .exec(&ss.db)
            .await
            .trace_ok();
    }
    let metadata_groups_to_delete = MetadataGroup::find()
        .select_only()
        .column(metadata_group::Column::Id)
        .left_join(UserToEntity)
        .filter(user_to_entity::Column::MetadataGroupId.is_null())
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    for chunk in metadata_groups_to_delete.chunks(BULK_DATABASE_UPDATE_OR_DELETE_CHUNK_SIZE) {
        ryot_log!(debug, "Deleting {} metadata groups", chunk.len());
        MetadataGroup::delete_many()
            .filter(metadata_group::Column::Id.is_in(chunk))
            .exec(&ss.db)
            .await
            .trace_ok();
    }
    let genre_to_delete = Genre::find()
        .select_only()
        .column(genre::Column::Id)
        .left_join(MetadataToGenre)
        .filter(metadata_to_genre::Column::MetadataId.is_null())
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    for chunk in genre_to_delete.chunks(BULK_DATABASE_UPDATE_OR_DELETE_CHUNK_SIZE) {
        ryot_log!(debug, "Deleting {} genres", chunk.len());
        Genre::delete_many()
            .filter(genre::Column::Id.is_in(chunk))
            .exec(&ss.db)
            .await
            .trace_ok();
    }
    ryot_log!(debug, "Deleting revoked access tokens");
    AccessLink::delete_many()
        .filter(access_link::Column::IsRevoked.eq(true))
        .exec(&ss.db)
        .await
        .trace_ok();
    ryot_log!(debug, "Deleting expired application caches");
    ApplicationCache::delete_many()
        .filter(application_cache::Column::ExpiresAt.lt(Utc::now()))
        .exec(&ss.db)
        .await
        .trace_ok();
    Ok(())
}

async fn put_entities_in_partial_state(ss: &Arc<SupportingService>) -> Result<()> {
    async fn update_partial_states<Column1, Column2, Column3, T>(
        ute_filter_column: Column1,
        updater: UpdateMany<T>,
        entity_id_column: Column2,
        entity_update_column: Column3,
        db: &DatabaseConnection,
    ) -> Result<()>
    where
        Column1: ColumnTrait,
        Column2: ColumnTrait,
        Column3: ColumnTrait,
        T: EntityTrait,
    {
        let ids_to_update = UserToEntity::find()
            .select_only()
            .column(ute_filter_column)
            .filter(ute_filter_column.is_not_null())
            .into_tuple::<String>()
            .all(db)
            .await?;
        for chunk in ids_to_update.chunks(BULK_DATABASE_UPDATE_OR_DELETE_CHUNK_SIZE) {
            ryot_log!(debug, "Entities to update: {:?}", chunk);
            updater
                .clone()
                .col_expr(entity_update_column, Expr::value(true))
                .filter(entity_id_column.is_in(chunk))
                .exec(db)
                .await?;
        }
        Ok(())
    }
    update_partial_states(
        user_to_entity::Column::MetadataId,
        Metadata::update_many(),
        metadata::Column::Id,
        metadata::Column::IsPartial,
        &ss.db,
    )
    .await?;
    update_partial_states(
        user_to_entity::Column::MetadataGroupId,
        MetadataGroup::update_many(),
        metadata_group::Column::Id,
        metadata_group::Column::IsPartial,
        &ss.db,
    )
    .await?;
    update_partial_states(
        user_to_entity::Column::PersonId,
        Person::update_many(),
        person::Column::Id,
        person::Column::IsPartial,
        &ss.db,
    )
    .await?;
    Ok(())
}

async fn queue_notifications_for_outdated_seen_entries(ss: &Arc<SupportingService>) -> Result<()> {
    if !is_server_key_validated(ss).await? {
        return Ok(());
    }
    for state in [SeenState::InProgress, SeenState::OnAHold] {
        let days = match state {
            SeenState::InProgress => 7,
            SeenState::OnAHold => 14,
            _ => unreachable!(),
        };
        let threshold = Utc::now() - Duration::days(days);
        let seen_items = Seen::find()
            .filter(seen::Column::State.eq(state))
            .filter(seen::Column::LastUpdatedOn.lte(threshold))
            .all(&ss.db)
            .await?;
        for seen_item in seen_items {
            let Some(metadata) = seen_item.find_related(Metadata).one(&ss.db).await? else {
                continue;
            };
            let state = seen_item
                .state
                .to_string()
                .to_case(Case::Title)
                .to_case(Case::Lower);
            send_notification_for_user(
                &seen_item.user_id,
                ss,
                &(
                    format!(
                        "{} ({}) has been kept {} for more than {} days. Last updated on: {}.",
                        metadata.title,
                        metadata.lot,
                        state,
                        days,
                        seen_item.last_updated_on.date_naive()
                    ),
                    UserNotificationContent::OutdatedSeenEntries,
                ),
            )
            .await?;
        }
    }
    Ok(())
}

async fn expire_cache_keys(ss: &Arc<SupportingService>) -> Result<()> {
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
        all_keys.push(ExpireCacheKeyInput::ByKey(
            ApplicationCacheKey::UserMetadataRecommendationsSet(UserLevelCacheKey {
                input: (),
                user_id: user_id.clone(),
            }),
        ));
    }
    all_keys.push(ExpireCacheKeyInput::ByKey(
        ApplicationCacheKey::TrendingMetadataIds,
    ));

    for key in all_keys {
        ss.cache_service.expire_key(key).await?;
    }
    Ok(())
}

async fn regenerate_user_summaries(ss: &Arc<SupportingService>) -> Result<()> {
    let all_users = get_enabled_users_query()
        .select_only()
        .column(user::Column::Id)
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    for user_id in all_users {
        calculate_user_activities_and_summary(&user_id, ss, false).await?;
    }
    Ok(())
}

async fn sync_integrations_data_to_owned_collection(ss: &Arc<SupportingService>) -> Result<()> {
    ss.perform_application_job(ApplicationJob::Mp(MpApplicationJob::SyncIntegrationsData))
        .await?;
    Ok(())
}

async fn revoke_invalid_access_tokens(ss: &Arc<SupportingService>) -> Result<()> {
    let access_links = AccessLink::find()
        .select_only()
        .column(access_link::Column::Id)
        .filter(
            Condition::any()
                .add(
                    Expr::col(access_link::Column::TimesUsed)
                        .gte(Expr::col(access_link::Column::MaximumUses)),
                )
                .add(access_link::Column::ExpiresOn.lte(Utc::now())),
        )
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    for access_link in access_links {
        revoke_access_link(&ss.db, access_link).await?;
    }
    Ok(())
}

async fn rebalance_collection_ranks(ss: &Arc<SupportingService>) -> Result<()> {
    let detect_fragmented_collections_query = r#"
        SELECT DISTINCT collection_id, COUNT(*) as item_count
        FROM collection_to_entity
        WHERE collection_id IN (
            SELECT collection_id
            FROM collection_to_entity
            WHERE (
                -- Ranks with more than 3 decimal places (fragmented)
                SCALE(rank) > 3
                OR
                -- Collections with many fractional ranks (> 10% of items)
                collection_id IN (
                    SELECT collection_id
                    FROM collection_to_entity
                    WHERE rank != TRUNC(rank)
                    GROUP BY collection_id
                    HAVING COUNT(*) * 10 > (
                        SELECT COUNT(*)
                        FROM collection_to_entity cte2
                        WHERE cte2.collection_id = collection_to_entity.collection_id
                    )
                )
            )
        )
        GROUP BY collection_id
        HAVING COUNT(*) > 1
    "#;

    let fragmented_collections: Vec<(String, i64)> = ss
        .db
        .query_all(Statement::from_string(
            ss.db.get_database_backend(),
            detect_fragmented_collections_query,
        ))
        .await?
        .into_iter()
        .map(|row| {
            let collection_id: String = row.try_get("", "collection_id").unwrap_or_default();
            let item_count: i64 = row.try_get("", "item_count").unwrap_or_default();
            (collection_id, item_count)
        })
        .collect();

    if fragmented_collections.is_empty() {
        ryot_log!(debug, "No fragmented collection ranks found to rebalance");
        return Ok(());
    }

    let collections_count = fragmented_collections.len();
    ryot_log!(
        debug,
        "Found {} collections with fragmented ranks to rebalance",
        collections_count
    );

    for (collection_id, item_count) in fragmented_collections {
        let rebalance_query = format!(
            r#"
            UPDATE collection_to_entity
            SET rank = ranked_data.new_rank
            FROM (
                SELECT id,
                       ROW_NUMBER() OVER (ORDER BY rank ASC) as new_rank
                FROM collection_to_entity
                WHERE collection_id = '{}'
            ) ranked_data
            WHERE collection_to_entity.id = ranked_data.id
        "#,
            collection_id
        );

        let result = ss
            .db
            .execute(Statement::from_string(
                ss.db.get_database_backend(),
                rebalance_query,
            ))
            .await?;

        ryot_log!(
            debug,
            "Rebalanced {} items in collection {} (affected: {})",
            item_count,
            collection_id,
            result.rows_affected()
        );
    }

    ryot_log!(
        debug,
        "Completed rebalancing ranks for {} collections",
        collections_count
    );
    Ok(())
}

pub async fn perform_background_jobs(ss: &Arc<SupportingService>) -> Result<()> {
    ryot_log!(debug, "Starting background jobs...");

    ryot_log!(trace, "Checking for updates for monitored media");
    update_monitored_metadata_and_queue_notifications(ss)
        .await
        .trace_ok();
    ryot_log!(trace, "Checking for updates for monitored people");
    update_monitored_people_and_queue_notifications(ss)
        .await
        .trace_ok();
    ryot_log!(trace, "Removing stale entities from Monitoring collection");
    remove_old_entities_from_monitoring_collection(ss)
        .await
        .trace_ok();
    ryot_log!(trace, "Checking and queuing any pending reminders");
    queue_pending_reminders(ss).await.trace_ok();
    ryot_log!(trace, "Recalculating calendar events");
    recalculate_calendar_events(ss).await.trace_ok();
    ryot_log!(trace, "Queuing notifications for released media");
    queue_notifications_for_released_media(ss).await.trace_ok();
    ryot_log!(trace, "Cleaning up user and metadata association");
    cleanup_user_and_metadata_association(ss).await.trace_ok();
    ryot_log!(trace, "Removing old user summaries and regenerating them");
    regenerate_user_summaries(ss).await.trace_ok();
    ryot_log!(trace, "Syncing integrations data to owned collection");
    sync_integrations_data_to_owned_collection(ss)
        .await
        .trace_ok();
    ryot_log!(trace, "Queueing notifications for outdated seen entries");
    queue_notifications_for_outdated_seen_entries(ss)
        .await
        .trace_ok();
    ryot_log!(trace, "Removing useless data");
    remove_useless_data(ss).await.trace_ok();
    ryot_log!(trace, "Putting entities in partial state");
    put_entities_in_partial_state(ss).await.trace_ok();
    // DEV: Invalid access tokens are revoked before being deleted, so we call this
    // function after removing useless data.
    ryot_log!(trace, "Revoking invalid access tokens");
    revoke_invalid_access_tokens(ss).await.trace_ok();
    ryot_log!(trace, "Rebalancing fragmented collection ranks");
    rebalance_collection_ranks(ss).await.trace_ok();
    ryot_log!(trace, "Expiring cache keys");
    expire_cache_keys(ss).await.trace_ok();

    ryot_log!(debug, "Completed background jobs...");
    Ok(())
}
