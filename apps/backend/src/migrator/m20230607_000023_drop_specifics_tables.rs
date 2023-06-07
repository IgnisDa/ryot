use sea_orm_migration::prelude::*;

use super::{
    m20230416_000003_create_book::Book, m20230423_000006_create_movie::Movie,
    m20230425_000007_create_show::Show, m20230502_000008_create_video_game::VideoGame,
    m20230504_000011_create_audio_book::AudioBook, m20230514_000015_create_podcast::Podcast,
};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230607_000023_drop_specifics_tables"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AudioBook::Table).cascade().to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Book::Table).cascade().to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Movie::Table).cascade().to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Podcast::Table).cascade().to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Show::Table).cascade().to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(VideoGame::Table).cascade().to_owned())
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
