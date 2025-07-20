use anyhow::Result;
use enum_models::EntityLot;
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};

use super::{prelude::UserToEntity, user_to_entity};

pub async fn get_user_to_entity_association<C>(
    db: &C,
    user_id: &String,
    entity_id: &String,
    entity_lot: EntityLot,
) -> Result<Option<user_to_entity::Model>>
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
    let ute = UserToEntity::find()
        .filter(user_to_entity::Column::UserId.eq(user_id.to_owned()))
        .filter(column.eq(entity_id))
        .one(db)
        .await?;
    Ok(ute)
}
