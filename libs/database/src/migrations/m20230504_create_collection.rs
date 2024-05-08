use sea_orm_migration::prelude::*;

pub static COLLECTION_NAME_INDEX: &str = "collection__name__index";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum Collection {
    Table,
    Id,
    CreatedOn,
    LastUpdatedOn,
    Name,
    Description,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Collection::Table)
                    .col(
                        ColumnDef::new(Collection::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(Collection::CreatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(Collection::Name).text().not_null())
                    .col(ColumnDef::new(Collection::Description).text())
                    .col(
                        ColumnDef::new(Collection::LastUpdatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name(COLLECTION_NAME_INDEX)
                    .table(Collection::Table)
                    .col(Collection::Name)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
