use anyhow::Result;
use database_models::{prelude::UserToEntity, user_to_entity, workout};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, ModelTrait,
    QueryFilter,
};

// DEV: For exercises, reduce count, remove from history if present. We will not
// re-calculate exercise associations totals or change personal bests.
pub async fn delete_existing_workout(
    input: workout::Model,
    db: &DatabaseConnection,
    user_id: String,
) -> Result<()> {
    for (idx, ex) in input.information.exercises.iter().enumerate() {
        let association = match UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(&user_id))
            .filter(user_to_entity::Column::ExerciseId.eq(ex.name.clone()))
            .one(db)
            .await?
        {
            None => continue,
            Some(assoc) => assoc,
        };
        let mut ei = association
            .exercise_extra_information
            .clone()
            .unwrap_or_default();
        if let Some(ex_idx) = ei
            .history
            .iter()
            .position(|e| e.workout_id == input.id && e.idx == idx)
        {
            ei.history.remove(ex_idx);
        }
        let mut association: user_to_entity::ActiveModel = association.into();
        association.exercise_extra_information = ActiveValue::Set(Some(ei));
        association.update(db).await?;
    }
    input.delete(db).await?;
    Ok(())
}
