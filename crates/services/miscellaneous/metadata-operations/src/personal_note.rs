use anyhow::{Result, bail};
use chrono::Utc;
use database_models::personal_note::{self, Entity, Model};
use sea_orm::{ActiveValue::Set, DatabaseConnection, EntityTrait, sea_query::OnConflict};

pub async fn get(
    db: &DatabaseConnection,
    user_id: String,
    metadata_id: String,
) -> Result<Option<Model>> {
    Ok(Entity::find_by_id((user_id, metadata_id)).one(db).await?)
}

pub async fn set(
    db: &DatabaseConnection,
    user_id: String,
    metadata_id: String,
    text: String,
) -> Result<Model> {
    if text.trim().is_empty() || text.chars().count() > 16000 {
        bail!("Personal note must contain between 1 and 16000 characters");
    }
    let now = Utc::now();
    let model = personal_note::ActiveModel {
        text: Set(text),
        user_id: Set(user_id.clone()),
        metadata_id: Set(metadata_id.clone()),
        created_at: Set(now),
        updated_at: Set(now),
    };
    Entity::insert(model)
        .on_conflict(
            OnConflict::columns([
                personal_note::Column::UserId,
                personal_note::Column::MetadataId,
            ])
            .update_columns([
                personal_note::Column::Text,
                personal_note::Column::UpdatedAt,
            ])
            .to_owned(),
        )
        .exec_without_returning(db)
        .await?;
    get(db, user_id, metadata_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Personal note not found after saving"))
}

pub async fn delete(db: &DatabaseConnection, user_id: String, metadata_id: String) -> Result<bool> {
    Ok(Entity::delete_by_id((user_id, metadata_id))
        .exec(db)
        .await?
        .rows_affected
        > 0)
}
