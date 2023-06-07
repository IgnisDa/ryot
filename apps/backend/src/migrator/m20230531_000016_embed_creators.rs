use crate::{
    entities::{creator::Entity as Creator, metadata, prelude::Metadata},
    media::{MetadataCreator, MetadataCreators},
};
use sea_orm::{ActiveModelTrait, ActiveValue, EntityTrait, ModelTrait};
use sea_orm_migration::prelude::*;

use super::{Metadata as MetadataModel, MetadataLot};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230531_000016_embed_creators"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(MetadataModel::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(MetadataModel::Creators).json().default("[]"),
                    )
                    .to_owned(),
            )
            .await
            .ok();
        let db = manager.get_connection();
        let metadatas = Metadata::find().all(db).await.unwrap();
        for metadata in metadatas {
            let mut creators = vec![];
            let prev_creators = metadata.find_related(Creator).all(db).await.unwrap();
            for p_c in prev_creators {
                let mut to_push = MetadataCreator {
                    name: p_c.name,
                    role: "".to_owned(),
                    image_urls: vec![],
                };
                match metadata.lot {
                    MetadataLot::AudioBook => {
                        to_push.role = "Narrator".to_owned();
                    }
                    MetadataLot::Book => {
                        to_push.role = "Author".to_owned();
                    }
                    MetadataLot::Podcast => {
                        to_push.role = "Host".to_owned();
                    }
                    MetadataLot::Movie => {
                        to_push.role = "Actor".to_owned();
                    }
                    MetadataLot::Show => {
                        to_push.role = "Actor".to_owned();
                    }
                    MetadataLot::VideoGame => {
                        to_push.role = "Publisher".to_owned();
                    }
                };
                creators.push(to_push);
            }
            let mut metadata: metadata::ActiveModel = metadata.into();
            metadata.creators = ActiveValue::Set(MetadataCreators(creators));
            metadata.save(db).await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
