use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use super::m20230410_000002_create_metadata::MediaItemMetadata;

static METADATA_TO_IMAGE_FOREIGN_KEY: &str = "metadata_to_image_foreign_key";

pub struct Migration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize)]
#[sea_orm(rs_type = "String", db_type = "String(Some(1))")]
pub enum MediaItemMetadataImageLot {
    #[sea_orm(string_value = "B")]
    Backdrop,
    #[sea_orm(string_value = "P")]
    Poster,
}

// This is responsible for storing common metadata about all media items
#[derive(Iden)]
enum MediaItemMetadataImage {
    Table,
    Id,
    Lot,
    Url,
    MetadataId,
}

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230410_000001_create_initial_tables"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(MediaItemMetadataImage::Table)
                    .col(
                        ColumnDef::new(MediaItemMetadataImage::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(MediaItemMetadataImage::Url)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MediaItemMetadataImage::Lot)
                            .enumeration(
                                MediaItemMetadataImageLotEnum.into_iden(),
                                MediaItemMetadataImageLotEnum.into_iter(),
                            )
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MediaItemMetadataImage::MetadataId)
                            .integer()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name(METADATA_TO_IMAGE_FOREIGN_KEY)
                            .from(
                                MediaItemMetadataImage::Table,
                                MediaItemMetadataImage::MetadataId,
                            )
                            .to(MediaItemMetadata::Table, MediaItemMetadata::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(MediaItemMetadataImage::Table)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}
