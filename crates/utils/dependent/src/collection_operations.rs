use std::{collections::HashSet, sync::Arc};

use anyhow::{Result, anyhow, bail};
use background_models::{ApplicationJob, LpApplicationJob};
use chrono::Utc;
use common_models::{
    ChangeCollectionToEntitiesInput, DefaultCollection, EntityToCollectionInput,
    ReorderCollectionEntityInput, StringIdObject,
};
use common_utils::ryot_log;
use database_models::{collection, collection_to_entity, prelude::*, user_to_entity};
use database_utils::server_key_validation_guard;
use dependent_core_utils::is_server_key_validated;
use enum_models::EntityLot;
use futures::try_join;
use media_models::CreateOrUpdateCollectionInput;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, FromQueryResult, IntoActiveModel,
    Iterable, QueryFilter, QueryOrder, QuerySelect, TransactionTrait, prelude::Expr,
};
use sea_query::OnConflict;
use supporting_service::SupportingService;
use uuid::Uuid;

use crate::{
    expire_user_collection_contents_cache,
    utility_operations::{
        associate_user_with_entity, expire_user_collections_list_cache,
        mark_entity_as_recently_consumed,
    },
};

#[derive(FromQueryResult)]
struct CollectionEntityRank {
    id: Uuid,
    rank: Decimal,
    entity_id: String,
}

async fn add_single_entity_to_collection(
    user_id: &String,
    entity: &EntityToCollectionInput,
    collection_name: &String,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    let collection = Collection::find()
        .left_join(UserToEntity)
        .filter(user_to_entity::Column::UserId.eq(user_id))
        .filter(collection::Column::Name.eq(collection_name))
        .one(&ss.db)
        .await?
        .unwrap();
    let mut updated = collection.into_active_model();
    updated.last_updated_on = ActiveValue::Set(Utc::now());
    let collection = updated.update(&ss.db).await?;
    let resp = match CollectionToEntity::find()
        .filter(collection_to_entity::Column::CollectionId.eq(collection.id.clone()))
        .filter(collection_to_entity::Column::EntityId.eq(entity.entity_id.clone()))
        .filter(collection_to_entity::Column::EntityLot.eq(entity.entity_lot))
        .one(&ss.db)
        .await?
    {
        Some(etc) => {
            let mut to_update = etc.into_active_model();
            to_update.last_updated_on = ActiveValue::Set(Utc::now());
            to_update.information = ActiveValue::Set(entity.information.clone());
            to_update.update(&ss.db).await?
        }
        None => {
            let min_rank = CollectionToEntity::find()
                .filter(collection_to_entity::Column::CollectionId.eq(&collection.id))
                .select_only()
                .column_as(collection_to_entity::Column::Rank.min(), "min_rank")
                .into_tuple::<Option<Decimal>>()
                .one(&ss.db)
                .await?
                .flatten()
                .unwrap_or_else(|| dec!(1));

            let new_rank = min_rank - dec!(1);

            let mut created_collection = collection_to_entity::ActiveModel {
                rank: ActiveValue::Set(new_rank),
                collection_id: ActiveValue::Set(collection.id.clone()),
                information: ActiveValue::Set(entity.information.clone()),
                ..Default::default()
            };
            let id = entity.entity_id.clone();
            match entity.entity_lot {
                EntityLot::Metadata => created_collection.metadata_id = ActiveValue::Set(Some(id)),
                EntityLot::Person => created_collection.person_id = ActiveValue::Set(Some(id)),
                EntityLot::MetadataGroup => {
                    created_collection.metadata_group_id = ActiveValue::Set(Some(id))
                }
                EntityLot::Exercise => created_collection.exercise_id = ActiveValue::Set(Some(id)),
                EntityLot::Workout => created_collection.workout_id = ActiveValue::Set(Some(id)),
                EntityLot::WorkoutTemplate => {
                    created_collection.workout_template_id = ActiveValue::Set(Some(id))
                }
                EntityLot::Collection | EntityLot::Review | EntityLot::UserMeasurement => {
                    unreachable!()
                }
            }
            let created = created_collection.insert(&ss.db).await?;
            ryot_log!(debug, "Created collection to entity: {:?}", created);
            match entity.entity_lot {
                EntityLot::Workout
                | EntityLot::WorkoutTemplate
                | EntityLot::Review
                | EntityLot::UserMeasurement => {}
                _ => {
                    associate_user_with_entity(user_id, &entity.entity_id, entity.entity_lot, ss)
                        .await
                        .ok();
                }
            }
            created
        }
    };
    try_join!(
        mark_entity_as_recently_consumed(user_id, &entity.entity_id, entity.entity_lot, ss),
        expire_user_collections_list_cache(user_id, ss),
        expire_user_collection_contents_cache(user_id, &collection.id, ss)
    )?;
    ss.perform_application_job(ApplicationJob::Lp(
        LpApplicationJob::HandleEntityAddedToCollectionEvent(resp.id),
    ))
    .await?;
    Ok(true)
}

pub async fn add_entities_to_collection(
    user_id: &String,
    input: ChangeCollectionToEntitiesInput,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    for entity in &input.entities {
        add_single_entity_to_collection(user_id, entity, &input.collection_name, ss).await?;
    }
    Ok(true)
}

pub async fn create_or_update_collection(
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: CreateOrUpdateCollectionInput,
) -> Result<StringIdObject> {
    ryot_log!(debug, "Creating or updating collection: {:?}", input);
    let txn = ss.db.begin().await?;
    let meta = Collection::find()
        .filter(collection::Column::Name.eq(input.name.clone()))
        .filter(collection::Column::UserId.eq(user_id))
        .one(&txn)
        .await?;
    let mut new_name = input.name.clone();
    let mut collaborators_to_expire_cache: Option<HashSet<String>> = None;
    let created = match meta {
        Some(m) if input.update_id.is_none() => m.id,
        _ => {
            let id = match input.update_id {
                None => ActiveValue::NotSet,
                Some(i) => {
                    let already = Collection::find_by_id(i.clone()).one(&txn).await?.unwrap();
                    if DefaultCollection::iter()
                        .map(|s| s.to_string())
                        .collect::<Vec<_>>()
                        .contains(&already.name)
                    {
                        new_name = already.name;
                    }
                    ActiveValue::Unchanged(i.clone())
                }
            };
            let col = collection::ActiveModel {
                id,
                name: ActiveValue::Set(new_name),
                user_id: ActiveValue::Set(user_id.to_owned()),
                last_updated_on: ActiveValue::Set(Utc::now()),
                description: ActiveValue::Set(input.description),
                information_template: ActiveValue::Set(input.information_template),
                ..Default::default()
            };
            let inserted = col
                .save(&txn)
                .await
                .map_err(|_| anyhow!("There was an error creating the collection"))?;
            let id = inserted.id.unwrap();
            let result = UserToEntity::delete_many()
                .filter(user_to_entity::Column::CollectionId.eq(&id))
                .exec(&txn)
                .await?;
            ryot_log!(debug, "Deleted old user to entity: {:?}", result);
            let mut collaborators = HashSet::from([user_id.to_owned()]);
            if let Some(input_collaborators) = input.collaborators {
                collaborators.extend(input_collaborators);
            }
            ryot_log!(debug, "Collaborators: {:?}", collaborators);
            collaborators_to_expire_cache = Some(collaborators.clone());
            for c in collaborators {
                UserToEntity::insert(user_to_entity::ActiveModel {
                    user_id: ActiveValue::Set(c.clone()),
                    last_updated_on: ActiveValue::Set(Utc::now()),
                    collection_id: ActiveValue::Set(Some(id.clone())),
                    collection_extra_information: match &c == user_id {
                        true => ActiveValue::Set(input.extra_information.clone()),
                        _ => Default::default(),
                    },
                    ..Default::default()
                })
                .on_conflict(
                    OnConflict::new()
                        .exprs([
                            Expr::col(user_to_entity::Column::UserId),
                            Expr::col(user_to_entity::Column::CollectionId),
                        ])
                        .update_columns([
                            user_to_entity::Column::CollectionExtraInformation,
                            user_to_entity::Column::LastUpdatedOn,
                        ])
                        .to_owned(),
                )
                .exec_without_returning(&txn)
                .await?;
            }
            id
        }
    };
    txn.commit().await?;

    if let Some(collaborators) = collaborators_to_expire_cache {
        for c in &collaborators {
            expire_user_collections_list_cache(c, ss).await?;
        }
    }
    Ok(StringIdObject { id: created })
}

async fn remove_single_entity_from_collection(
    user_id: &String,
    entity: &EntityToCollectionInput,
    collection_name: &String,
    creator_user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    let collect = Collection::find()
        .left_join(UserToEntity)
        .filter(collection::Column::Name.eq(collection_name))
        .filter(user_to_entity::Column::UserId.eq(creator_user_id))
        .one(&ss.db)
        .await?
        .unwrap();
    CollectionToEntity::delete_many()
        .filter(collection_to_entity::Column::CollectionId.eq(collect.id.clone()))
        .filter(collection_to_entity::Column::EntityId.eq(entity.entity_id.clone()))
        .filter(collection_to_entity::Column::EntityLot.eq(entity.entity_lot))
        .exec(&ss.db)
        .await?;
    if entity.entity_lot != EntityLot::Workout && entity.entity_lot != EntityLot::WorkoutTemplate {
        associate_user_with_entity(user_id, &entity.entity_id, entity.entity_lot, ss)
            .await
            .ok();
    }
    expire_user_collections_list_cache(user_id, ss).await?;
    expire_user_collection_contents_cache(user_id, &collect.id, ss).await?;
    Ok(true)
}

pub async fn remove_entities_from_collection(
    user_id: &String,
    input: ChangeCollectionToEntitiesInput,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    for entity in &input.entities {
        remove_single_entity_from_collection(
            user_id,
            entity,
            &input.collection_name,
            &input.creator_user_id,
            ss,
        )
        .await?;
    }
    Ok(true)
}

pub async fn reorder_collection_entity(
    user_id: &String,
    input: ReorderCollectionEntityInput,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    server_key_validation_guard(is_server_key_validated(ss).await?).await?;

    let collection = Collection::find()
        .filter(collection::Column::Name.eq(&input.collection_name))
        .filter(collection::Column::UserId.eq(user_id))
        .one(&ss.db)
        .await?;

    let collection = match collection {
        Some(c) => c,
        None => bail!("Collection not found"),
    };

    let all_entities = CollectionToEntity::find()
        .filter(collection_to_entity::Column::CollectionId.eq(&collection.id))
        .select_only()
        .column(collection_to_entity::Column::Id)
        .column(collection_to_entity::Column::EntityId)
        .column(collection_to_entity::Column::Rank)
        .order_by_asc(collection_to_entity::Column::Rank)
        .into_model::<CollectionEntityRank>()
        .all(&ss.db)
        .await?;

    if all_entities.is_empty() {
        bail!("Collection is empty");
    }

    if input.new_position < 1 || input.new_position > all_entities.len() {
        bail!(
            "Invalid position: must be between 1 and {}",
            all_entities.len()
        );
    }

    let entity_to_reorder = all_entities.iter().find(|e| e.entity_id == input.entity_id);

    let entity_to_reorder = match entity_to_reorder {
        Some(e) => e,
        None => bail!("Entity not found in collection"),
    };

    let new_rank = if input.new_position == 1 {
        let min_rank = all_entities.first().unwrap().rank;
        min_rank - dec!(1)
    } else if input.new_position == all_entities.len() {
        let max_rank = all_entities.last().unwrap().rank;
        max_rank + dec!(1)
    } else {
        let prev_rank = all_entities[input.new_position - 1].rank;
        let next_rank = all_entities[input.new_position].rank;
        (prev_rank + next_rank) / dec!(2)
    };

    CollectionToEntity::update_many()
        .filter(collection_to_entity::Column::Id.eq(entity_to_reorder.id))
        .col_expr(collection_to_entity::Column::Rank, Expr::value(new_rank))
        .exec(&ss.db)
        .await?;

    expire_user_collection_contents_cache(user_id, &collection.id, ss).await?;

    Ok(true)
}
