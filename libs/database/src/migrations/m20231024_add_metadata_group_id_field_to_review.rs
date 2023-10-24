use sea_orm_migration::prelude::*;

use super::{
    m20230505_create_review::METADATA_GROUP_TO_REVIEW_FOREIGN_KEY,
    m20230901_create_metadata_group::MetadataGroup, Review,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("review", "metadata_group_id").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Review::Table)
                        .add_column(ColumnDef::new(Review::MetadataGroupId).integer().null())
                        .to_owned(),
                )
                .await?;
            manager
                .alter_table(
                    Table::alter()
                        .table(Review::Table)
                        .add_foreign_key(
                            TableForeignKey::new()
                                .name(METADATA_GROUP_TO_REVIEW_FOREIGN_KEY)
                                .from_tbl(Review::Table)
                                .from_col(Review::MetadataGroupId)
                                .to_tbl(MetadataGroup::Table)
                                .to_col(MetadataGroup::Id)
                                .on_delete(ForeignKeyAction::Cascade)
                                .on_update(ForeignKeyAction::Cascade),
                        )
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
