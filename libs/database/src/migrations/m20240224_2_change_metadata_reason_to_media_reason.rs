use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let has_media_reason = manager.has_column("user_to_entity", "media_reason").await?;
        let has_metadata_reason = manager
            .has_column("user_to_entity", "metadata_reason")
            .await?;
        if has_metadata_reason && !has_media_reason {
            let db = manager.get_connection();
            db.execute_unprepared(
                r#"ALTER TABLE user_to_entity RENAME COLUMN metadata_reason TO media_reason"#,
            )
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
