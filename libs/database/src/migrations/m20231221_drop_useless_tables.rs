use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();
        if manager.has_table("metadata_to_partial_metadata").await? {
            conn.execute_unprepared("drop table metadata_to_partial_metadata cascade;")
                .await?;
        }
        if manager
            .has_table("partial_metadata_to_metadata_group")
            .await?
        {
            conn.execute_unprepared("drop table partial_metadata_to_metadata_group cascade;")
                .await?;
        }
        if manager.has_table("person_to_partial_metadata").await? {
            conn.execute_unprepared("drop table person_to_partial_metadata cascade;")
                .await?;
        }
        if manager.has_table("partial_metadata").await? {
            conn.execute_unprepared("drop table partial_metadata cascade;")
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
