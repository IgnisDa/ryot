use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum MetadataGroup {
    Table,
    Id,
    Parts,
    Identifier,
    Title,
    Description,
    Images,
    Lot,
    Source,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(MetadataGroup::Table)
                    .col(
                        ColumnDef::new(MetadataGroup::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(MetadataGroup::Identifier).text().not_null())
                    .col(ColumnDef::new(MetadataGroup::Parts).integer().not_null())
                    .col(ColumnDef::new(MetadataGroup::Title).text().not_null())
                    .col(ColumnDef::new(MetadataGroup::Description).text())
                    .col(ColumnDef::new(MetadataGroup::Lot).text().not_null())
                    .col(ColumnDef::new(MetadataGroup::Source).text().not_null())
                    .col(
                        ColumnDef::new(MetadataGroup::Images)
                            .json_binary()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .unique()
                    .name("metadata_group-identifier-source-lot__unique-index")
                    .table(MetadataGroup::Table)
                    .col(MetadataGroup::Identifier)
                    .col(MetadataGroup::Source)
                    .col(MetadataGroup::Lot)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
