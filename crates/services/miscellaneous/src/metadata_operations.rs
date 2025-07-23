use std::sync::Arc;

use anyhow::Result;
use common_utils::ryot_log;
use database_models::{
    collection, collection_to_entity,
    functions::get_user_to_entity_association,
    prelude::{Collection, CollectionToEntity, Review, Seen, UserToEntity},
    review, seen, user_to_entity,
};
use database_utils::entity_in_collections_with_collection_to_entity_ids;
use dependent_utils::expire_user_metadata_list_cache;
use enum_models::EntityLot;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, IntoActiveModel, ModelTrait,
    PaginatorTrait, QueryFilter, QuerySelect, TransactionTrait,
};
use supporting_service::SupportingService;

pub async fn merge_metadata(
    ss: &Arc<SupportingService>,
    user_id: String,
    merge_from: String,
    merge_into: String,
) -> Result<bool> {
    let txn = ss.db.begin().await?;
    for old_seen in Seen::find()
        .filter(seen::Column::MetadataId.eq(&merge_from))
        .filter(seen::Column::UserId.eq(&user_id))
        .all(&txn)
        .await?
    {
        let old_seen_active = old_seen.clone().into_active_model();
        let new_seen = seen::ActiveModel {
            id: ActiveValue::NotSet,
            last_updated_on: ActiveValue::NotSet,
            num_times_updated: ActiveValue::NotSet,
            metadata_id: ActiveValue::Set(merge_into.clone()),
            ..old_seen_active
        };
        new_seen.insert(&txn).await?;
        old_seen.delete(&txn).await?;
    }
    for old_review in Review::find()
        .filter(review::Column::MetadataId.eq(&merge_from))
        .filter(review::Column::UserId.eq(&user_id))
        .all(&txn)
        .await?
    {
        let old_review_active = old_review.clone().into_active_model();
        let new_review = review::ActiveModel {
            id: ActiveValue::NotSet,
            metadata_id: ActiveValue::Set(Some(merge_into.clone())),
            ..old_review_active
        };
        new_review.insert(&txn).await?;
        old_review.delete(&txn).await?;
    }
    let collections = Collection::find()
        .select_only()
        .column(collection::Column::Id)
        .left_join(UserToEntity)
        .filter(user_to_entity::Column::UserId.eq(&user_id))
        .into_tuple::<String>()
        .all(&txn)
        .await
        .unwrap();
    for item in CollectionToEntity::find()
        .filter(collection_to_entity::Column::MetadataId.eq(&merge_from))
        .filter(collection_to_entity::Column::CollectionId.is_in(collections))
        .all(&txn)
        .await?
        .into_iter()
    {
        // TODO: https://github.com/SeaQL/sea-orm/discussions/730#discussioncomment-13440496
        if CollectionToEntity::find()
            .filter(collection_to_entity::Column::CollectionId.eq(item.collection_id.clone()))
            .filter(collection_to_entity::Column::MetadataId.eq(&merge_into))
            .count(&txn)
            .await?
            == 0
        {
            let mut item_active = item.into_active_model();
            item_active.metadata_id = ActiveValue::Set(Some(merge_into.clone()));
            item_active.update(&txn).await?;
        }
    }
    if let Some(_association) =
        get_user_to_entity_association(&txn, &user_id, &merge_into, EntityLot::Metadata).await?
    {
        let old_association =
            get_user_to_entity_association(&txn, &user_id, &merge_from, EntityLot::Metadata)
                .await?
                .unwrap();
        let mut cloned = old_association.clone().into_active_model();
        cloned.needs_to_be_updated = ActiveValue::Set(Some(true));
        cloned.update(&txn).await?;
    } else {
        UserToEntity::update_many()
            .filter(user_to_entity::Column::MetadataId.eq(merge_from))
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .set(user_to_entity::ActiveModel {
                metadata_id: ActiveValue::Set(Some(merge_into.clone())),
                ..Default::default()
            })
            .exec(&txn)
            .await?;
    }
    txn.commit().await?;
    Ok(true)
}

pub async fn disassociate_metadata(
    ss: &Arc<SupportingService>,
    user_id: String,
    metadata_id: String,
) -> Result<bool> {
    let delete_review = Review::delete_many()
        .filter(review::Column::MetadataId.eq(&metadata_id))
        .filter(review::Column::UserId.eq(&user_id))
        .exec(&ss.db)
        .await?;
    ryot_log!(debug, "Deleted {} reviews", delete_review.rows_affected);
    let delete_seen = Seen::delete_many()
        .filter(seen::Column::MetadataId.eq(&metadata_id))
        .filter(seen::Column::UserId.eq(&user_id))
        .exec(&ss.db)
        .await?;
    ryot_log!(debug, "Deleted {} seen items", delete_seen.rows_affected);
    let collections_part_of = entity_in_collections_with_collection_to_entity_ids(
        &ss.db,
        &user_id,
        &metadata_id,
        EntityLot::Metadata,
    )
    .await?
    .into_iter()
    .map(|(_, id)| id);
    let delete_collections = CollectionToEntity::delete_many()
        .filter(collection_to_entity::Column::Id.is_in(collections_part_of))
        .exec(&ss.db)
        .await?;
    ryot_log!(
        debug,
        "Deleted {} collections",
        delete_collections.rows_affected
    );
    UserToEntity::delete_many()
        .filter(user_to_entity::Column::MetadataId.eq(metadata_id.clone()))
        .filter(user_to_entity::Column::UserId.eq(user_id.clone()))
        .exec(&ss.db)
        .await?;
    expire_user_metadata_list_cache(&user_id, ss).await?;
    Ok(true)
}
