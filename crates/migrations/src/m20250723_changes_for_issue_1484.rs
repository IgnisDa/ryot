use sea_orm::Statement;
use sea_orm_migration::prelude::*;

use super::m20231016_create_collection_to_entity::CollectionToEntity;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        manager
            .alter_table(
                Table::alter()
                    .table(CollectionToEntity::Table)
                    .add_column(ColumnDef::new(CollectionToEntity::Rank).integer())
                    .to_owned(),
            )
            .await?;

        let collections_query = r#"
            SELECT DISTINCT collection_id FROM collection_to_entity
        "#;

        let collections = db
            .query_all(Statement::from_string(
                manager.get_database_backend(),
                collections_query.to_string(),
            ))
            .await?;

        for collection_row in collections {
            let collection_id: String = collection_row.try_get("", "collection_id")?;

            let update_ranks_query = format!(
                r#"
                UPDATE collection_to_entity
                SET rank = ranked_data.rank
                FROM (
                    SELECT id, ROW_NUMBER() OVER (ORDER BY last_updated_on DESC) as rank
                    FROM collection_to_entity
                    WHERE collection_id = '{}'
                ) ranked_data
                WHERE collection_to_entity.id = ranked_data.id
            "#,
                collection_id
            );

            db.execute(Statement::from_string(
                manager.get_database_backend(),
                update_ranks_query,
            ))
            .await?;
        }

        manager
            .alter_table(
                Table::alter()
                    .table(CollectionToEntity::Table)
                    .modify_column(
                        ColumnDef::new(CollectionToEntity::Rank)
                            .integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
