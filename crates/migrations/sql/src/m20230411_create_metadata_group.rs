use migrations_utils::create_trigram_index_if_required;
use sea_orm_migration::prelude::*;

use super::m20230404_create_user::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static METADATA_GROUP_TITLE_TRIGRAM_INDEX: &str = "metadata_group_title_trigram_idx";
pub static METADATA_GROUP_TO_USER_FOREIGN_KEY: &str = "metadata_group_to_user_foreign_key";
pub static METADATA_GROUP_DESCRIPTION_TRIGRAM_INDEX: &str =
    "metadata_group_description_trigram_idx";

#[derive(Iden)]
pub enum MetadataGroup {
    Id,
    Lot,
    Table,
    Parts,
    Title,
    Assets,
    Source,
    IsPartial,
    SourceUrl,
    Identifier,
    Description,
    LastUpdatedOn,
    CreatedByUserId,
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
                    .col(ColumnDef::new(MetadataGroup::CreatedByUserId).text())
                    .col(
                        ColumnDef::new(MetadataGroup::LastUpdatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name(METADATA_GROUP_TO_USER_FOREIGN_KEY)
                            .from(MetadataGroup::Table, MetadataGroup::CreatedByUserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
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

        create_trigram_index_if_required(
            manager,
            "metadata_group",
            "title",
            METADATA_GROUP_TITLE_TRIGRAM_INDEX,
        )
        .await?;
        create_trigram_index_if_required(
            manager,
            "metadata_group",
            "description",
            METADATA_GROUP_DESCRIPTION_TRIGRAM_INDEX,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
