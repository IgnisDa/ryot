use std::{collections::HashSet, sync::Arc};

use async_graphql::{Error, Result};
use background_models::{ApplicationJob, LpApplicationJob};
use chrono::Utc;
use common_models::{ChangeCollectionToEntityInput, DefaultCollection, StringIdObject};
use common_utils::ryot_log;
use database_models::{collection, collection_to_entity, prelude::*, user_to_entity};
use enum_models::EntityLot;
use media_models::CreateOrUpdateCollectionInput;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, Iterable, QueryFilter,
    TransactionTrait, prelude::Expr,
};
use sea_query::OnConflict;
use supporting_service::SupportingService;

use crate::utility_operations::{
    associate_user_with_entity, expire_user_collections_list_cache,
    mark_entity_as_recently_consumed,
};

pub async fn add_entity_to_collection(
    user_id: &String,
    input: ChangeCollectionToEntityInput,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    let collection = Collection::find()
        .left_join(UserToEntity)
        .filter(user_to_entity::Column::UserId.eq(user_id))
        .filter(collection::Column::Name.eq(input.collection_name))
        .one(&ss.db)
        .await?
        .unwrap();
    let mut updated: collection::ActiveModel = collection.into();
    updated.last_updated_on = ActiveValue::Set(Utc::now());
    let collection = updated.update(&ss.db).await?;
    let resp = match CollectionToEntity::find()
        .filter(collection_to_entity::Column::CollectionId.eq(collection.id.clone()))
        .filter(collection_to_entity::Column::EntityId.eq(input.entity_id.clone()))
        .filter(collection_to_entity::Column::EntityLot.eq(input.entity_lot))
        .one(&ss.db)
        .await?
    {
        Some(etc) => etc,
        None => {
            let mut created_collection = collection_to_entity::ActiveModel {
                collection_id: ActiveValue::Set(collection.id),
                information: ActiveValue::Set(input.information),
                ..Default::default()
            };
            let id = input.entity_id.clone();
            match input.entity_lot {
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
            match input.entity_lot {
                EntityLot::Workout
                | EntityLot::WorkoutTemplate
                | EntityLot::Review
                | EntityLot::UserMeasurement => {}
                _ => {
                    associate_user_with_entity(user_id, &input.entity_id, input.entity_lot, ss)
                        .await
                        .ok();
                }
            }
            created
        }
    };
    mark_entity_as_recently_consumed(user_id, &input.entity_id, input.entity_lot, ss).await?;
    ss.perform_application_job(ApplicationJob::Lp(
        LpApplicationJob::HandleEntityAddedToCollectionEvent(resp.id),
    ))
    .await?;
    expire_user_collections_list_cache(user_id, ss).await?;
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
                .map_err(|_| Error::new("There was an error creating the collection".to_owned()))?;
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

pub async fn remove_entity_from_collection(
    user_id: &String,
    input: ChangeCollectionToEntityInput,
    ss: &Arc<SupportingService>,
) -> Result<StringIdObject> {
    let collect = Collection::find()
        .left_join(UserToEntity)
        .filter(collection::Column::Name.eq(input.collection_name))
        .filter(user_to_entity::Column::UserId.eq(input.creator_user_id))
        .one(&ss.db)
        .await?
        .unwrap();
    CollectionToEntity::delete_many()
        .filter(collection_to_entity::Column::CollectionId.eq(collect.id.clone()))
        .filter(collection_to_entity::Column::EntityId.eq(input.entity_id.clone()))
        .filter(collection_to_entity::Column::EntityLot.eq(input.entity_lot))
        .exec(&ss.db)
        .await?;
    if input.entity_lot != EntityLot::Workout && input.entity_lot != EntityLot::WorkoutTemplate {
        associate_user_with_entity(user_id, &input.entity_id, input.entity_lot, ss)
            .await
            .ok();
    }
    expire_user_collections_list_cache(user_id, ss).await?;
    Ok(StringIdObject { id: collect.id })
}
