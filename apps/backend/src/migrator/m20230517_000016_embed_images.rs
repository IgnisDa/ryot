use sea_orm::{ActiveModelTrait, ActiveValue, EntityTrait};
use sea_orm_migration::prelude::*;

use super::Metadata;
use crate::{
    entities::{
        metadata,
        prelude::{Metadata as MetadataModel, MetadataImage as MetadataImageModel},
    },
    media::{MetadataImage as MetadataImageEmbedded, MetadataImages as MetadataImagesEmbedded},
};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230517_000016_embed_images"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        manager
            .alter_table(
                Table::alter()
                    .table(Metadata::Table)
                    .add_column(ColumnDef::new(Metadata::Images).json().default("[]"))
                    .to_owned(),
            )
            .await?;
        let metas = MetadataModel::find()
            .find_with_related(MetadataImageModel)
            .all(db)
            .await?;
        for (meta, images) in metas.into_iter() {
            let mut meta: metadata::ActiveModel = meta.into();
            let images = images
                .into_iter()
                .map(|i| MetadataImageEmbedded {
                    url: i.url,
                    lot: i.lot,
                })
                .collect();
            meta.images = ActiveValue::Set(MetadataImagesEmbedded(images));
            meta.update(db).await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Metadata::Table)
                    .drop_column(Metadata::Images)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}
