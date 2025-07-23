use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        if manager.has_column("collection_to_entity", "rank").await? {
            return Ok(());
        }

        db.execute_unprepared("ALTER TABLE collection_to_entity ADD COLUMN rank INTEGER")
            .await?;

        let update_ranks_query = r#"
            UPDATE collection_to_entity
            SET rank = ranked_data.new_rank
            FROM (
                SELECT id,
                       ROW_NUMBER() OVER (PARTITION BY collection_id ORDER BY last_updated_on DESC) as new_rank
                FROM collection_to_entity
            ) ranked_data
            WHERE collection_to_entity.id = ranked_data.id
        "#;

        db.execute_unprepared(update_ranks_query).await?;

        db.execute_unprepared("ALTER TABLE collection_to_entity ALTER COLUMN rank SET NOT NULL")
            .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
