use sea_orm_migration::prelude::*;

use super::m20231016_create_collection_to_entity::CollectionToEntity;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        if manager.has_column("collection_to_entity", "rank").await? {
            return Ok(());
        }

        manager
            .alter_table(
                Table::alter()
                    .table(CollectionToEntity::Table)
                    .add_column(ColumnDef::new(CollectionToEntity::Rank).decimal())
                    .to_owned(),
            )
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

        manager
            .alter_table(
                Table::alter()
                    .table(CollectionToEntity::Table)
                    .modify_column(ColumnDef::new(CollectionToEntity::Rank).not_null())
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
