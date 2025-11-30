use anyhow::Result;
use common_models::EntityWithLot;
use enum_models::EntityLot;
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};

use crate::{prelude::UserToEntity, user_to_entity};

pub async fn get_user_to_entity_association<C>(
    db: &C,
    user_id: &String,
    entity: EntityWithLot,
) -> Result<Option<user_to_entity::Model>>
where
    C: ConnectionTrait,
{
    let column = match entity.entity_lot {
        EntityLot::Person => user_to_entity::Column::PersonId,
        EntityLot::Metadata => user_to_entity::Column::MetadataId,
        EntityLot::Exercise => user_to_entity::Column::ExerciseId,
        EntityLot::MetadataGroup => user_to_entity::Column::MetadataGroupId,
        EntityLot::Genre
        | EntityLot::Review
        | EntityLot::Workout
        | EntityLot::Collection
        | EntityLot::WorkoutTemplate
        | EntityLot::UserMeasurement => unreachable!(),
    };
    let ute = UserToEntity::find()
        .filter(column.eq(entity.entity_id))
        .filter(user_to_entity::Column::UserId.eq(user_id.to_owned()))
        .one(db)
        .await?;
    Ok(ute)
}
