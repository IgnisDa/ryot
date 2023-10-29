use sea_orm_migration::prelude::*;

use super::{
    m20230505_create_review::Review, m20230505_create_review::COLLECTION_TO_REVIEW_FOREIGN_KEY,
    m20230507_create_collection::Collection,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("review", "collection_id").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Review::Table)
                        .add_column(ColumnDef::new(Review::CollectionId).integer().null())
                        .to_owned(),
                )
                .await?;
            manager
                .alter_table(
                    Table::alter()
                        .table(Review::Table)
                        .add_foreign_key(
                            TableForeignKey::new()
                                .name(COLLECTION_TO_REVIEW_FOREIGN_KEY)
                                .from_tbl(Review::Table)
                                .from_col(Review::CollectionId)
                                .to_tbl(Collection::Table)
                                .to_col(Collection::Id)
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
