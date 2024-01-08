use sea_orm_migration::prelude::*;

use crate::migrations::m20230413_create_person::Person;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("person", "source_specifics").await? {
            manager
                .alter_table(
                    TableAlterStatement::new()
                        .table(Person::Table)
                        .add_column(ColumnDef::new(Person::SourceSpecifics).json_binary())
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
