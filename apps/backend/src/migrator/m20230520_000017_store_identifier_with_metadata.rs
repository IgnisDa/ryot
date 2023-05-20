use sea_orm::{ActiveModelTrait, ActiveValue, EntityTrait, ModelTrait};
use sea_orm_migration::prelude::*;

use super::{Metadata, MetadataLot};
use crate::entities::{
    metadata,
    prelude::{self, Metadata as MetadataModel},
};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230520_000017_store_identifier_with_metadata"
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
                    .add_column_if_not_exists(
                        ColumnDef::new(Metadata::Identifier).string().default(""),
                    )
                    .to_owned(),
            )
            .await?;
        let metas = MetadataModel::find().all(db).await?;
        for meta in metas.into_iter() {
            let mut meta_to_change: metadata::ActiveModel = meta.clone().into();
            let identifier = match meta.lot {
                MetadataLot::AudioBook => {
                    meta.find_related(prelude::AudioBook)
                        .one(db)
                        .await?
                        .unwrap()
                        .identifier
                }
                MetadataLot::Book => {
                    meta.find_related(prelude::Book)
                        .one(db)
                        .await?
                        .unwrap()
                        .identifier
                }
                MetadataLot::Movie => {
                    meta.find_related(prelude::Movie)
                        .one(db)
                        .await?
                        .unwrap()
                        .identifier
                }
                MetadataLot::Podcast => {
                    meta.find_related(prelude::Podcast)
                        .one(db)
                        .await?
                        .unwrap()
                        .identifier
                }
                MetadataLot::Show => {
                    meta.find_related(prelude::Show)
                        .one(db)
                        .await?
                        .unwrap()
                        .identifier
                }
                MetadataLot::VideoGame => {
                    meta.find_related(prelude::VideoGame)
                        .one(db)
                        .await?
                        .unwrap()
                        .identifier
                }
            };
            meta_to_change.identifier = ActiveValue::Set(identifier);
            meta_to_change.save(db).await?;
        }
        manager
            .create_index(
                Index::create()
                    .name("metadata_identifier__index")
                    .table(Metadata::Table)
                    .col(Metadata::Identifier)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Metadata::Table)
                    .drop_column(Metadata::Identifier)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}
