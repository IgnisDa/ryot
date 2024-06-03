use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
DO $$
DECLARE
    record RECORD;
    item JSONB;
    new_failed_items JSONB;
    new_lot TEXT;
BEGIN
    FOR record IN SELECT id, details FROM import_report LOOP
        new_failed_items := '[]'::jsonb;
        FOR item IN SELECT jsonb_array_elements(record.details->'failed_items') LOOP
            new_lot := CASE item->>'lot'
                WHEN 'AudioBook' THEN 'audio_book'
                WHEN 'Anime' THEN 'anime'
                WHEN 'Book' THEN 'book'
                WHEN 'Podcast' THEN 'podcast'
                WHEN 'Manga' THEN 'manga'
                WHEN 'Movie' THEN 'movie'
                WHEN 'Show' THEN 'show'
                WHEN 'VideoGame' THEN 'video_game'
                WHEN 'VisualNovel' THEN 'visual_novel'
                ELSE item->>'lot'
            END;

            IF new_lot IS NOT NULL THEN
                item := jsonb_set(item, '{lot}', to_jsonb(new_lot));
            END IF;

            new_failed_items := new_failed_items || item;
        END LOOP;

        UPDATE import_report
        SET details = jsonb_set(record.details, '{failed_items}', new_failed_items)
        WHERE id = record.id;
    END LOOP;
END;
$$ LANGUAGE plpgsql;
        "#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
