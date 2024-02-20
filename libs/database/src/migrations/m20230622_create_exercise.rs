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
                    .col(
                        ColumnDef::new(Exercise::Id)
                            .primary_key()
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Exercise::Muscles).json_binary().not_null())
                    .col(ColumnDef::new(Exercise::Lot).string_len(2).not_null())
                    .col(ColumnDef::new(Exercise::Level).string_len(1).not_null())
                    .col(ColumnDef::new(Exercise::Force).string_len(3))
                    .col(ColumnDef::new(Exercise::Mechanic).string_len(1))
                    .col(ColumnDef::new(Exercise::Equipment).string_len(3))
                    .col(ColumnDef::new(Exercise::Identifier).string().unique_key())
                    .col(
                        ColumnDef::new(Exercise::Attributes)
                            .json_binary()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Exercise::Source).string_len(2).not_null())
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
