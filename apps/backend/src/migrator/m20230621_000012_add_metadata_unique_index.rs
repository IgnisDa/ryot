use sea_orm_migration::prelude::*;

use super::{
    m20230410_000001_create_metadata::{MetadataImage, UNIQUE_INDEX},
    Metadata,
};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230621_000012_add_metadata_unique_index"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .unique()
                    .name(UNIQUE_INDEX)
                    .table(Metadata::Table)
                    .col(Metadata::Identifier)
                    .col(Metadata::Source)
                    .col(Metadata::Lot)
                    .to_owned(),
            )
            .await
            .ok();
        if manager.has_table("metadata_image").await? {
            manager
                .drop_table(Table::drop().table(MetadataImage::Table).to_owned())
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
