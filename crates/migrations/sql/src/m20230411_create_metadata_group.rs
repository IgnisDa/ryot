use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static METADATA_GROUP_TITLE_TRIGRAM_INDEX: &str = "metadata_group_title_trigram_idx";
pub static METADATA_GROUP_DESCRIPTION_TRIGRAM_INDEX: &str =
    "metadata_group_description_trigram_idx";

#[derive(Iden)]
pub enum MetadataGroup {
    Table,
    Id,
    Parts,
    Identifier,
    Title,
    Description,
    Assets,
    Lot,
    Source,
    IsPartial,
    SourceUrl,
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
                            .text()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(MetadataGroup::Identifier).text().not_null())
                    .col(
                        ColumnDef::new(MetadataGroup::Parts)
                            .integer()
                            .default(0)
                            .not_null(),
                    )
                    .col(ColumnDef::new(MetadataGroup::Title).text().not_null())
                    .col(ColumnDef::new(MetadataGroup::Description).text())
                    .col(ColumnDef::new(MetadataGroup::Lot).text().not_null())
                    .col(ColumnDef::new(MetadataGroup::Source).text().not_null())
                    .col(ColumnDef::new(MetadataGroup::IsPartial).boolean())
                    .col(ColumnDef::new(MetadataGroup::SourceUrl).text())
                    .col(
                        ColumnDef::new(MetadataGroup::Assets)
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

        let db = manager.get_connection();
        db.execute_unprepared(&format!(
            r#"CREATE INDEX "{METADATA_GROUP_TITLE_TRIGRAM_INDEX}" ON metadata_group USING gin (title gin_trgm_ops);"#
        ))
        .await?;

        db.execute_unprepared(&format!(
            r#"CREATE INDEX "{METADATA_GROUP_DESCRIPTION_TRIGRAM_INDEX}" ON metadata_group USING gin (description gin_trgm_ops);"#
        ))
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
