use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column("user_to_entity", "media_reason").await? {
            let db = manager.get_connection();
            db.execute_unprepared(
                r#"
                    UPDATE user_to_entity
SET media_reason = array_replace(media_reason, 'Monitored', 'Monitoring')
WHERE 'Monitored' = ANY(media_reason);
            "#,
            )
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
