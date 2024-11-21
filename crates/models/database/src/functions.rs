use async_graphql::Result;
use chrono::Utc;
use enums::EntityLot;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter,
};

use crate::{prelude::UserToEntity, user_to_entity};

pub async fn get_user_to_entity_association<C>(
    db: &C,
    user_id: &String,
    entity_id: String,
    entity_lot: EntityLot,
) -> Option<user_to_entity::Model>
where
    C: ConnectionTrait,
{
    let column = match entity_lot {
        EntityLot::Metadata => user_to_entity::Column::MetadataId,
        EntityLot::Person => user_to_entity::Column::PersonId,
        EntityLot::Exercise => user_to_entity::Column::ExerciseId,
        EntityLot::MetadataGroup => user_to_entity::Column::MetadataGroupId,
        EntityLot::Collection
        | EntityLot::Workout
        | EntityLot::WorkoutTemplate
        | EntityLot::Review
        | EntityLot::UserMeasurement => unreachable!(),
    };
    UserToEntity::find()
        .filter(user_to_entity::Column::UserId.eq(user_id.to_owned()))
        .filter(column.eq(entity_id))
        .one(db)
        .await
        .ok()
        .flatten()
}

pub async fn associate_user_with_entity<C>(
    db: &C,
    user_id: &String,
    entity_id: String,
    entity_lot: EntityLot,
) -> Result<user_to_entity::Model>
where
    C: ConnectionTrait,
{
    let user_to_meta =
        get_user_to_entity_association(db, user_id, entity_id.clone(), entity_lot).await;
    Ok(match user_to_meta {
        None => {
            let mut user_to_meta = user_to_entity::ActiveModel {
                user_id: ActiveValue::Set(user_id.to_owned()),
                last_updated_on: ActiveValue::Set(Utc::now()),
                needs_to_be_updated: ActiveValue::Set(Some(true)),
                ..Default::default()
            };
            match entity_lot {
                EntityLot::Metadata => user_to_meta.metadata_id = ActiveValue::Set(Some(entity_id)),
                EntityLot::Person => user_to_meta.person_id = ActiveValue::Set(Some(entity_id)),
                EntityLot::Exercise => user_to_meta.exercise_id = ActiveValue::Set(Some(entity_id)),
                EntityLot::MetadataGroup => {
                    user_to_meta.metadata_group_id = ActiveValue::Set(Some(entity_id))
                }
                EntityLot::Collection
                | EntityLot::Workout
                | EntityLot::WorkoutTemplate
                | EntityLot::Review
                | EntityLot::UserMeasurement => {
                    unreachable!()
                }
            }
            user_to_meta.insert(db).await.unwrap()
        }
        Some(u) => {
            let mut to_update: user_to_entity::ActiveModel = u.into();
            to_update.last_updated_on = ActiveValue::Set(Utc::now());
            to_update.needs_to_be_updated = ActiveValue::Set(Some(true));
            to_update.update(db).await.unwrap()
        }
    })
}
