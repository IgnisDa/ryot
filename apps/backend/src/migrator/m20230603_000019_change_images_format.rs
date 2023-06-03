use sea_orm::{
    ActiveModelBehavior, ActiveModelTrait, ActiveValue, DeriveEntityModel, DerivePrimaryKey,
    DeriveRelation, EntityTrait, EnumIter, FromJsonQueryResult, PrimaryKeyTrait,
};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use crate::{
    entities::metadata,
    media::{MetadataImage, MetadataImageUrl, MetadataImages},
};

use super::{
    m20230410_000001_create_metadata::MetadataImage as MetadataImageEnum, MetadataImageLot,
};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230603_000019_change_images_format"
    }
}

#[derive(Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize, Default)]
pub struct TempMetadataImage {
    url: String,
    lot: MetadataImageLot,
}

#[derive(Clone, Debug, PartialEq, FromJsonQueryResult, Eq, Serialize, Deserialize, Default)]
pub struct TempMetadataImages(Vec<TempMetadataImage>);

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize, Default)]
#[sea_orm(table_name = "metadata")]
pub struct Model {
    #[sea_orm(primary_key)]
    id: i32,
    images: TempMetadataImages,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        let metadatas = Entity::find().all(db).await.unwrap();
        for metadata in metadatas {
            let mut images = vec![];
            for image in metadata.images.0 {
                let img = MetadataImage {
                    url: MetadataImageUrl::Url(image.url),
                    lot: image.lot,
                };
                images.push(img);
            }
            let new_metadata = metadata::ActiveModel {
                id: ActiveValue::Unchanged(metadata.id),
                images: ActiveValue::Set(MetadataImages(images)),
                ..Default::default()
            };
            new_metadata.save(db).await?;
        }
        manager
            .drop_table(
                Table::drop()
                    .table(MetadataImageEnum::Table)
                    .cascade()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
