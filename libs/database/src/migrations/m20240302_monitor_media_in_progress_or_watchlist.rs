use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if manager
            .has_column("user_to_entity", "media_monitored")
            .await?
        {
            db.execute_unprepared(
                r#"
UPDATE user_to_entity
SET media_monitored = true
FROM collection_to_entity cte
JOIN collection c ON cte.collection_id = c.id
WHERE (c.name = 'In Progress' OR c.name = 'Watchlist')
AND (user_to_entity.metadata_id = cte.metadata_id OR user_to_entity.person_id = cte.person_id);
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
