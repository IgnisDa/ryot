use async_graphql::{Error, Result};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter,
};

use crate::{prelude::UserToEntity, user_to_entity};

pub async fn get_user_to_entity_association<C>(
    user_id: &String,
    metadata_id: Option<String>,
    person_id: Option<String>,
    exercise_id: Option<String>,
    metadata_group_id: Option<String>,
    db: &C,
) -> Option<user_to_entity::Model>
where
    C: ConnectionTrait,
{
    UserToEntity::find()
        .filter(user_to_entity::Column::UserId.eq(user_id.to_owned()))
        .filter(
            user_to_entity::Column::MetadataId
                .eq(metadata_id.to_owned())
                .or(user_to_entity::Column::PersonId
                    .eq(person_id.to_owned())
                    .or(user_to_entity::Column::ExerciseId.eq(exercise_id.to_owned()))
                    .or(user_to_entity::Column::MetadataGroupId.eq(metadata_group_id.to_owned()))),
        )
        .one(db)
        .await
        .ok()
        .flatten()
}

pub async fn associate_user_with_entity<C>(
    user_id: &String,
    metadata_id: Option<String>,
    person_id: Option<String>,
    exercise_id: Option<String>,
    metadata_group_id: Option<String>,
    db: &C,
) -> Result<user_to_entity::Model>
where
    C: ConnectionTrait,
{
    if metadata_id.is_none()
        && person_id.is_none()
        && exercise_id.is_none()
        && metadata_group_id.is_none()
    {
        return Err(Error::new("No entity to associate to."));
    }
    let user_to_meta = get_user_to_entity_association(
        user_id,
        metadata_id.clone(),
        person_id.clone(),
        exercise_id.clone(),
        metadata_group_id.clone(),
        db,
    )
    .await;
    Ok(match user_to_meta {
        None => {
            let user_to_meta = user_to_entity::ActiveModel {
                user_id: ActiveValue::Set(user_id.to_owned()),
                metadata_id: ActiveValue::Set(metadata_id),
                person_id: ActiveValue::Set(person_id),
                exercise_id: ActiveValue::Set(exercise_id),
                metadata_group_id: ActiveValue::Set(metadata_group_id),
                last_updated_on: ActiveValue::Set(Utc::now().naive_utc()),
                needs_to_be_updated: ActiveValue::Set(Some(true)),
                ..Default::default()
            };
            user_to_meta.insert(db).await.unwrap()
        }
        Some(u) => {
            let mut to_update: user_to_entity::ActiveModel = u.into();
            to_update.last_updated_on = ActiveValue::Set(Utc::now().naive_utc());
            to_update.needs_to_be_updated = ActiveValue::Set(Some(true));
            to_update.update(db).await.unwrap()
        }
    })
}
