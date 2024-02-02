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

UPDATE metadata SET audio_book_specifics = specifics -> 'd' where lot = 'AB' AND specifics IS NOT NULL;
UPDATE metadata SET anime_specifics = specifics -> 'd' where lot = 'AN' AND specifics IS NOT NULL;
UPDATE metadata SET book_specifics = specifics -> 'd' where lot = 'BO' AND specifics IS NOT NULL;
UPDATE metadata SET podcast_specifics = specifics -> 'd' where lot = 'PO' AND specifics IS NOT NULL;
UPDATE metadata SET manga_specifics = specifics -> 'd' where lot = 'MA' AND specifics IS NOT NULL;
UPDATE metadata SET movie_specifics = specifics -> 'd' where lot = 'MO' AND specifics IS NOT NULL;
UPDATE metadata SET show_specifics = specifics -> 'd' where lot = 'SH' AND specifics IS NOT NULL;
UPDATE metadata SET video_game_specifics = specifics -> 'd' where lot = 'VG' AND specifics IS NOT NULL;
UPDATE metadata SET visual_novel_specifics = specifics -> 'd' where lot = 'VN' AND specifics IS NOT NULL;

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
