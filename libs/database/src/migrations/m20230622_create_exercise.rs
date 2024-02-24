use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum Exercise {
    Table,
    Id,
    Lot,
    Force,
    Level,
    Mechanic,
    Equipment,
    Muscles,
    Identifier,
    Attributes,
    Source,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Exercise::Table)
                    .col(ColumnDef::new(Exercise::Id).primary_key().text().not_null())
                    .col(ColumnDef::new(Exercise::Identifier).text().unique_key())
                    .col(ColumnDef::new(Exercise::Lot).text().not_null())
                    .col(ColumnDef::new(Exercise::Level).text().not_null())
                    .col(ColumnDef::new(Exercise::Force).text())
                    .col(ColumnDef::new(Exercise::Mechanic).text())
                    .col(ColumnDef::new(Exercise::Equipment).text())
                    .col(ColumnDef::new(Exercise::Source).text().not_null())
                    .col(ColumnDef::new(Exercise::Muscles).json_binary().not_null())
                    .col(
                        ColumnDef::new(Exercise::Attributes)
                            .json_binary()
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
