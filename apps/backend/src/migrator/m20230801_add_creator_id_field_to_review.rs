use sea_orm_migration::prelude::*;

use super::{
    m20230505_000006_create_review::CREATOR_TO_REVIEW_FOREIGN_KEY,
    m20230730_create_creator::{get_metadata_to_creator_table, Creator, MetadataToCreator},
    Review,
};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230801_add_creator_id_field_to_review"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Review::Table)
                    .modify_column(ColumnDef::new(Review::MetadataId).integer().null())
                    .to_owned(),
            )
            .await?;
        if !manager.has_column("review", "creator_id").await? {
            let fk = TableForeignKey::new()
                .name(CREATOR_TO_REVIEW_FOREIGN_KEY)
                .from_tbl(Review::Table)
                .from_col(Review::CreatorId)
                .to_tbl(Creator::Table)
                .to_col(Creator::Id)
                .on_delete(ForeignKeyAction::Cascade)
                .on_update(ForeignKeyAction::Cascade)
                .to_owned();
            manager
                .alter_table(
                    Table::alter()
                        .table(Review::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(Review::CreatorId).integer().null(),
                        )
                        .add_foreign_key(&fk)
                        .to_owned(),
                )
                .await?;
        }
        // manager
        //     .drop_index(
        //         Index::drop()
        //             .table(MetadataToCreator::Table)
        //             .name(METADATA_TO_CREATOR_PRIMARY_KEY)
        //             .to_owned(),
        //     )
        //     .await?;
        // DEV: https://stackoverflow.com/a/8762186/11667450
        manager
            .drop_table(Table::drop().table(MetadataToCreator::Table).to_owned())
            .await?;
        manager
            .create_table(get_metadata_to_creator_table())
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
