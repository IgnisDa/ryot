use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();
        conn.execute_unprepared(
            "
alter table metadata alter column is_nsfw drop default;
alter table metadata alter column source set not null;

alter table metadata_to_person alter column index drop not null;
",
        )
        .await?;
        if manager.has_column("metadata", "specifics").await? {
            conn.execute_unprepared("alter table metadata alter column specifics drop not null")
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
