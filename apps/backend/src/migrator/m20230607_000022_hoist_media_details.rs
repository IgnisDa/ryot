use crate::{
    audio_books::AudioBookSpecifics,
    books::BookSpecifics,
    entities::{
        metadata,
        prelude::{AudioBook, Book, Metadata, Movie, Podcast, Show, VideoGame},
    },
    media::MediaSpecifics,
    movies::MovieSpecifics,
};
use sea_orm::{ActiveModelTrait, ActiveValue, EntityTrait};
use sea_orm_migration::prelude::*;

use super::{Metadata as MetadataModel, MetadataLot};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230607_000022_hoist_media_details"
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
                        ColumnDef::new(MetadataModel::Specifics)
                            .json()
                            .default(r#"{"t": "Book", "d": {}}"#),
                    )
                    .to_owned(),
            )
            .await
            .ok();
        let db = manager.get_connection();
        let metadatas = Metadata::find().all(db).await.unwrap();
        for metadata in metadatas {
            let specifics = match metadata.lot {
                MetadataLot::AudioBook => {
                    let d = AudioBook::find_by_id(metadata.id).one(db).await?.unwrap();
                    MediaSpecifics::AudioBook(AudioBookSpecifics { runtime: d.runtime })
                }
                MetadataLot::Book => {
                    let d = Book::find_by_id(metadata.id).one(db).await?.unwrap();
                    MediaSpecifics::Book(BookSpecifics { pages: d.num_pages })
                }
                MetadataLot::Movie => {
                    let d = Movie::find_by_id(metadata.id).one(db).await?.unwrap();
                    MediaSpecifics::Movie(MovieSpecifics { runtime: d.runtime })
                }
                MetadataLot::Podcast => {
                    let d = Podcast::find_by_id(metadata.id).one(db).await?.unwrap();
                    MediaSpecifics::Podcast(d.details)
                }
                MetadataLot::Show => {
                    let d = Show::find_by_id(metadata.id).one(db).await?.unwrap();
                    MediaSpecifics::Show(d.details)
                }
                MetadataLot::VideoGame => {
                    let d = VideoGame::find_by_id(metadata.id).one(db).await?.unwrap();
                    MediaSpecifics::VideoGame(d.details)
                }
            };
            let mut metadata: metadata::ActiveModel = metadata.into();
            metadata.specifics = ActiveValue::Set(specifics);
            metadata.save(db).await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
