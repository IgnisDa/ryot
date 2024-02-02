use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column("metadata", "specifics").await? {
            let db = manager.get_connection();
            db.execute_unprepared(
                r#"
ALTER TABLE metadata ADD COLUMN audio_book_specifics JSONB;
ALTER TABLE metadata ADD COLUMN anime_specifics JSONB;
ALTER TABLE metadata ADD COLUMN book_specifics JSONB;
ALTER TABLE metadata ADD COLUMN podcast_specifics JSONB;
ALTER TABLE metadata ADD COLUMN manga_specifics JSONB;
ALTER TABLE metadata ADD COLUMN movie_specifics JSONB;
ALTER TABLE metadata ADD COLUMN show_specifics JSONB;
ALTER TABLE metadata ADD COLUMN video_game_specifics JSONB;
ALTER TABLE metadata ADD COLUMN visual_novel_specifics JSONB;

UPDATE metadata set audio_book_specifics = specifics -> 'd' where lot = 'AB' and specifics IS NOT NULL;
UPDATE metadata set anime_specifics = specifics -> 'd' where lot = 'AN' and specifics IS NOT NULL;
UPDATE metadata set book_specifics = specifics -> 'd' where lot = 'BO' and specifics IS NOT NULL;
UPDATE metadata set podcast_specifics = specifics -> 'd' where lot = 'PO' and specifics IS NOT NULL;
UPDATE metadata set manga_specifics = specifics -> 'd' where lot = 'MA' and specifics IS NOT NULL;
UPDATE metadata set movie_specifics = specifics -> 'd' where lot = 'MO' and specifics IS NOT NULL;
UPDATE metadata set show_specifics = specifics -> 'd' where lot = 'SH' and specifics IS NOT NULL;
UPDATE metadata set video_game_specifics = specifics -> 'd' where lot = 'VG' and specifics IS NOT NULL;
UPDATE metadata set visual_novel_specifics = specifics -> 'd' where lot = 'VN' and specifics IS NOT NULL;

ALTER TABLE metadata DROP COLUMN specifics;
"#,
            )
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
