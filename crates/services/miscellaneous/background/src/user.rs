use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use anyhow::Result;
use common_models::DefaultCollection;
use common_utils::ryot_log;
use database_models::{
    collection,
    prelude::{Collection, Review, UserToEntity},
    review, user, user_to_entity,
};
use database_utils::{entity_in_collections_with_details, get_enabled_users_query};
use dependent_seen_utils::is_metadata_finished_by_user;
use dependent_utility_utils::expire_user_metadata_list_cache;
use enum_models::{EntityLot, UserToMediaReason};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, IntoActiveModel, ModelTrait,
    PaginatorTrait, QueryFilter, QuerySelect,
};
use supporting_service::SupportingService;

pub async fn cleanup_user_and_metadata_association(ss: &Arc<SupportingService>) -> Result<()> {
    let all_users = get_enabled_users_query()
        .select_only()
        .column(user::Column::Id)
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    for user_id in all_users {
        let collections = Collection::find()
            .filter(collection::Column::UserId.eq(&user_id))
            .all(&ss.db)
            .await?;

        let mut collection_id_map: HashMap<String, String> = HashMap::new();
        let target_collections = [
            DefaultCollection::Owned,
            DefaultCollection::Watchlist,
            DefaultCollection::Reminders,
            DefaultCollection::Monitoring,
        ];

        for default_collection in target_collections {
            let collection_name = default_collection.to_string();
            if let Some(collection) = collections.iter().find(|c| c.name == collection_name) {
                collection_id_map.insert(collection_name, collection.id.clone());
            }
        }

        let monitoring_collection_id =
            &collection_id_map[&DefaultCollection::Monitoring.to_string()];
        let watchlist_collection_id = &collection_id_map[&DefaultCollection::Watchlist.to_string()];
        let owned_collection_id = &collection_id_map[&DefaultCollection::Owned.to_string()];
        let reminder_collection_id = &collection_id_map[&DefaultCollection::Reminders.to_string()];

        let all_user_to_entities = UserToEntity::find()
            .filter(user_to_entity::Column::NeedsToBeUpdated.eq(true))
            .filter(user_to_entity::Column::UserId.eq(&user_id))
            .all(&ss.db)
            .await?;
        for ute in all_user_to_entities {
            let mut new_reasons = HashSet::new();
            let (entity_id, entity_lot) = if let Some(metadata_id) = ute.metadata_id.clone() {
                let (is_finished, seen_history) =
                    is_metadata_finished_by_user(&ute.user_id, &metadata_id, ss).await?;
                if !seen_history.is_empty() {
                    new_reasons.insert(UserToMediaReason::Seen);
                }
                if !seen_history.is_empty() && is_finished {
                    new_reasons.insert(UserToMediaReason::Finished);
                }
                (metadata_id, EntityLot::Metadata)
            } else if let Some(person_id) = ute.person_id.clone() {
                (person_id, EntityLot::Person)
            } else if let Some(metadata_group_id) = ute.metadata_group_id.clone() {
                (metadata_group_id, EntityLot::MetadataGroup)
            } else {
                ryot_log!(debug, "Skipping user_to_entity = {:?}", ute.id);
                continue;
            };

            let collections =
                entity_in_collections_with_details(&user_id, &entity_id, entity_lot, ss).await?;

            let mut is_in_collection = false;
            let mut is_monitoring = false;
            let mut is_watchlist = false;
            let mut is_owned = false;
            let mut has_reminder = false;

            for collection in collections {
                let collection_id = &collection.details.collection_id;
                is_in_collection = true;
                if collection_id == monitoring_collection_id {
                    is_monitoring = true;
                } else if collection_id == watchlist_collection_id {
                    is_watchlist = true;
                } else if collection_id == owned_collection_id {
                    is_owned = true;
                } else if collection_id == reminder_collection_id {
                    has_reminder = true;
                }
            }

            if Review::find()
                .filter(review::Column::UserId.eq(&ute.user_id))
                .filter(
                    review::Column::MetadataId
                        .eq(ute.metadata_id.clone())
                        .or(review::Column::MetadataGroupId.eq(ute.metadata_group_id.clone()))
                        .or(review::Column::PersonId.eq(ute.person_id.clone())),
                )
                .count(&ss.db)
                .await?
                > 0
            {
                new_reasons.insert(UserToMediaReason::Reviewed);
            }
            if is_in_collection {
                new_reasons.insert(UserToMediaReason::Collection);
            }
            if is_monitoring {
                new_reasons.insert(UserToMediaReason::Monitoring);
            }
            if is_watchlist {
                new_reasons.insert(UserToMediaReason::Watchlist);
            }
            if is_owned {
                new_reasons.insert(UserToMediaReason::Owned);
            }
            if has_reminder {
                new_reasons.insert(UserToMediaReason::Reminder);
            }
            let previous_reasons =
                HashSet::from_iter(ute.media_reason.clone().unwrap_or_default().into_iter());
            if new_reasons.is_empty() {
                ryot_log!(debug, "Deleting user_to_entity = {id:?}", id = (&ute.id));
                ute.delete(&ss.db).await?;
            } else {
                let mut ute = ute.into_active_model();
                if new_reasons != previous_reasons {
                    ryot_log!(debug, "Updating user_to_entity = {id:?}", id = (&ute.id));
                    ute.media_reason = ActiveValue::Set(Some(new_reasons.into_iter().collect()));
                }
                ute.needs_to_be_updated = ActiveValue::Set(None);
                ute.update(&ss.db).await?;
            }
        }
        expire_user_metadata_list_cache(&user_id, ss).await?;
    }
    Ok(())
}
