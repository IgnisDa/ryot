use sea_orm_migration::prelude::*;

use super::m20230413_create_person::Person;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if !manager.has_column("person", "is_partial").await? {
            manager
                .alter_table(
                    TableAlterStatement::new()
                        .table(Person::Table)
                        .add_column(ColumnDef::new(Person::IsPartial).boolean())
                        .to_owned(),
                )
                .await?;
            db.execute_unprepared("UPDATE person SET is_partial = false")
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
