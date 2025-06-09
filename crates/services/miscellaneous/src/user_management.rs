use std::{collections::HashSet, sync::Arc};

use async_graphql::Result;
use common_models::DefaultCollection;
use common_utils::ryot_log;
use database_models::{
    prelude::{Collection, Review, UserToEntity},
    review, user, user_to_entity,
};
use database_utils::{entity_in_collections, get_user_query};
use dependent_utils::{expire_user_metadata_list_cache, is_metadata_finished_by_user};
use enum_models::{EntityLot, UserToMediaReason};
use itertools::Itertools;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, ModelTrait, PaginatorTrait,
    QueryFilter, QuerySelect,
};
use supporting_service::SupportingService;

pub async fn cleanup_user_and_metadata_association(ss: &Arc<SupportingService>) -> Result<()> {
    let all_users = get_user_query()
        .select_only()
        .column(user::Column::Id)
        .into_tuple::<String>()
        .all(&ss.db)
        .await
        .unwrap();
    for user_id in all_users {
        let collections = Collection::find()
            .left_join(UserToEntity)
            .filter(user_to_entity::Column::UserId.eq(&user_id))
            .all(&ss.db)
            .await?;
        let monitoring_collection_id = collections
            .iter()
            .find(|c| c.name == DefaultCollection::Monitoring.to_string() && c.user_id == user_id)
            .map(|c| c.id.clone())
            .unwrap();
        let watchlist_collection_id = collections
            .iter()
            .find(|c| c.name == DefaultCollection::Watchlist.to_string() && c.user_id == user_id)
            .map(|c| c.id.clone())
            .unwrap();
        let owned_collection_id = collections
            .iter()
            .find(|c| c.name == DefaultCollection::Owned.to_string() && c.user_id == user_id)
            .map(|c| c.id.clone())
            .unwrap();
        let reminder_collection_id = collections
            .iter()
            .find(|c| c.name == DefaultCollection::Reminders.to_string() && c.user_id == user_id)
            .map(|c| c.id.clone())
            .unwrap();
        let all_user_to_entities = UserToEntity::find()
            .filter(user_to_entity::Column::NeedsToBeUpdated.eq(true))
            .filter(user_to_entity::Column::UserId.eq(&user_id))
            .all(&ss.db)
            .await?;
        for ute in all_user_to_entities {
            let mut new_reasons = HashSet::new();
            let (entity_id, entity_lot) = if let Some(metadata_id) = ute.metadata_id.clone() {
                let (is_finished, seen_history) =
                    is_metadata_finished_by_user(&ute.user_id, &metadata_id, &ss.db).await?;
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

            let collections_part_of =
                entity_in_collections(&ss.db, &user_id, &entity_id, entity_lot)
                    .await?
                    .into_iter()
                    .map(|c| c.id)
                    .collect_vec();
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
            let is_in_collection = !collections_part_of.is_empty();
            let is_monitoring = collections_part_of.contains(&monitoring_collection_id);
            let is_watchlist = collections_part_of.contains(&watchlist_collection_id);
            let is_owned = collections_part_of.contains(&owned_collection_id);
            let has_reminder = collections_part_of.contains(&reminder_collection_id);
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
                let mut ute: user_to_entity::ActiveModel = ute.into();
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
