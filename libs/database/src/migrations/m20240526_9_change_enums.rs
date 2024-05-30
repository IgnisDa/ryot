use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
UPDATE "metadata" SET lot = 'audio_book' where lot = 'AB';
UPDATE "metadata_group" SET lot = 'audio_book' where lot = 'AB';

UPDATE "metadata" SET lot = 'anime' where lot = 'AN';
UPDATE "metadata_group" SET lot = 'anime' where lot = 'AN';

UPDATE "metadata" SET lot = 'book' where lot = 'BO';
UPDATE "metadata_group" SET lot = 'book' where lot = 'BO';

UPDATE "metadata" SET lot = 'podcast' where lot = 'PO';
UPDATE "metadata_group" SET lot = 'podcast' where lot = 'PO';

UPDATE "metadata" SET lot = 'manga' where lot = 'MA';
UPDATE "metadata_group" SET lot = 'manga' where lot = 'MA';

UPDATE "metadata" SET lot = 'movie' where lot = 'MO';
UPDATE "metadata_group" SET lot = 'movie' where lot = 'MO';

UPDATE "metadata" SET lot = 'show' where lot = 'SH';
UPDATE "metadata_group" SET lot = 'show' where lot = 'SH';

UPDATE "metadata" SET lot = 'video_game' where lot = 'VG';
UPDATE "metadata_group" SET lot = 'video_game' where lot = 'VG';

UPDATE "metadata" SET lot = 'visual_novel' where lot = 'VN';
UPDATE "metadata_group" SET lot = 'visual_novel' where lot = 'VN';
        "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
UPDATE "metadata" SET source = 'anilist' WHERE source = 'AN';
UPDATE "metadata_group" SET source = 'anilist' WHERE source = 'AN';
UPDATE "person" SET source = 'anilist' WHERE source = 'AN';

UPDATE "metadata" SET source = 'audible' WHERE source = 'AU';
UPDATE "metadata_group" SET source = 'audible' WHERE source = 'AU';
UPDATE "person" SET source = 'audible' WHERE source = 'AU';

UPDATE "metadata" SET source = 'custom' WHERE source = 'CU';
UPDATE "metadata_group" SET source = 'custom' WHERE source = 'CU';
UPDATE "person" SET source = 'custom' WHERE source = 'CU';

UPDATE "metadata" SET source = 'google_books' WHERE source = 'GO';
UPDATE "metadata_group" SET source = 'google_books' WHERE source = 'GO';
UPDATE "person" SET source = 'google_books' WHERE source = 'GO';

UPDATE "metadata" SET source = 'igdb' WHERE source = 'IG';
UPDATE "metadata_group" SET source = 'igdb' WHERE source = 'IG';
UPDATE "person" SET source = 'igdb' WHERE source = 'IG';

UPDATE "metadata" SET source = 'itunes' WHERE source = 'IT';
UPDATE "metadata_group" SET source = 'itunes' WHERE source = 'IT';
UPDATE "person" SET source = 'itunes' WHERE source = 'IT';

UPDATE "metadata" SET source = 'listennotes' WHERE source = 'LI';
UPDATE "metadata_group" SET source = 'listennotes' WHERE source = 'LI';
UPDATE "person" SET source = 'listennotes' WHERE source = 'LI';

UPDATE "metadata" SET source = 'manga_updates' WHERE source = 'MU';
UPDATE "metadata_group" SET source = 'manga_updates' WHERE source = 'MU';
UPDATE "person" SET source = 'manga_updates' WHERE source = 'MU';

UPDATE "metadata" SET source = 'mal' WHERE source = 'MY';
UPDATE "metadata_group" SET source = 'mal' WHERE source = 'MY';
UPDATE "person" SET source = 'mal' WHERE source = 'MY';

UPDATE "metadata" SET source = 'openlibrary' WHERE source = 'OL';
UPDATE "metadata_group" SET source = 'openlibrary' WHERE source = 'OL';
UPDATE "person" SET source = 'openlibrary' WHERE source = 'OL';

UPDATE "metadata" SET source = 'tmdb' WHERE source = 'TM';
UPDATE "metadata_group" SET source = 'tmdb' WHERE source = 'TM';
UPDATE "person" SET source = 'tmdb' WHERE source = 'TM';

UPDATE "metadata" SET source = 'vndb' WHERE source = 'VN';
UPDATE "metadata_group" SET source = 'vndb' WHERE source = 'VN';
UPDATE "person" SET source = 'vndb' WHERE source = 'VN';
        "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
UPDATE "user" SET lot = 'admin' WHERE lot = 'A';
UPDATE "user" SET lot = 'normal' WHERE lot = 'N';
        "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
UPDATE "seen" SET state = 'completed' WHERE state = 'CO';
UPDATE "seen" SET state = 'dropped' WHERE state = 'DR';
UPDATE "seen" SET state = 'in_progress' WHERE state = 'IP';
UPDATE "seen" SET state = 'on_a_hold' WHERE state = 'OH';
        "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
UPDATE "review" SET visibility = 'public' WHERE visibility = 'PU';
UPDATE "review" SET visibility = 'private' WHERE visibility = 'PR';
        "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
UPDATE "import_report" SET source = 'audiobookshelf' WHERE source = 'AB';
UPDATE "import_report" SET source = 'generic_json' WHERE source = 'GJ';
UPDATE "import_report" SET source = 'goodreads' WHERE source = 'GO';
UPDATE "import_report" SET source = 'imdb' WHERE source = 'IM';
UPDATE "import_report" SET source = 'jellyfin' WHERE source = 'JE';
UPDATE "import_report" SET source = 'mal' WHERE source = 'MA';
UPDATE "import_report" SET source = 'movary' WHERE source = 'MO';
UPDATE "import_report" SET source = 'media_tracker' WHERE source = 'MT';
UPDATE "import_report" SET source = 'open_scale' WHERE source = 'OP';
UPDATE "import_report" SET source = 'strong_app' WHERE source = 'SA';
UPDATE "import_report" SET source = 'story_graph' WHERE source = 'ST';
UPDATE "import_report" SET source = 'trakt' WHERE source = 'TR';
        "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
UPDATE "metadata_to_metadata" SET relation = 'suggestion' WHERE relation = 'SU';
        "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
UPDATE "exercise" SET source = 'github' WHERE source = 'GH';
UPDATE "exercise" SET source = 'custom' WHERE source = 'CU';
        "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
UPDATE "exercise" SET lot = 'duration' WHERE lot = 'D';
UPDATE "exercise" SET lot = 'distance_and_duration' WHERE lot = 'DD';
UPDATE "exercise" SET lot = 'reps' WHERE lot = 'R';
UPDATE "exercise" SET lot = 'reps_and_weight' WHERE lot = 'RW';
        "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
UPDATE "exercise" SET force = 'pull' WHERE force = 'PUL';
UPDATE "exercise" SET force = 'push' WHERE force = 'PUS';
UPDATE "exercise" SET force = 'static' WHERE force = 'S';
        "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
UPDATE "exercise" SET level = 'beginner' WHERE level = 'B';
UPDATE "exercise" SET level = 'expert' WHERE level = 'E';
UPDATE "exercise" SET level = 'intermediate' WHERE level = 'I';
        "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
UPDATE "exercise" SET mechanic = 'compound' WHERE mechanic = 'C';
UPDATE "exercise" SET mechanic = 'isolation' WHERE mechanic = 'I';
        "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
UPDATE "exercise" SET equipment = 'bands' WHERE equipment = 'BAN';
UPDATE "exercise" SET equipment = 'barbell' WHERE equipment = 'BAR';
UPDATE "exercise" SET equipment = 'body_only' WHERE equipment = 'BO';
UPDATE "exercise" SET equipment = 'cable' WHERE equipment = 'C';
UPDATE "exercise" SET equipment = 'dumbbell' WHERE equipment = 'D';
UPDATE "exercise" SET equipment = 'exercise_ball' WHERE equipment = 'EX';
UPDATE "exercise" SET equipment = 'ez_curl_bar' WHERE equipment = 'EZ';
UPDATE "exercise" SET equipment = 'foam_roll' WHERE equipment = 'F';
UPDATE "exercise" SET equipment = 'kettlebells' WHERE equipment = 'K';
UPDATE "exercise" SET equipment = 'machine' WHERE equipment = 'MA';
UPDATE "exercise" SET equipment = 'medicine_ball' WHERE equipment = 'ME';
UPDATE "exercise" SET equipment = 'other' WHERE equipment = 'O';
        "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
UPDATE "user_to_entity"
SET media_reason = array_replace(media_reason, 'Seen', 'seen');
UPDATE "user_to_entity"
SET media_reason = array_replace(media_reason, 'Reviewed', 'reviewed');
UPDATE "user_to_entity"
SET media_reason = array_replace(media_reason, 'Collection', 'collection');
UPDATE "user_to_entity"
SET media_reason = array_replace(media_reason, 'Reminder', 'reminder');
UPDATE "user_to_entity"
SET media_reason = array_replace(media_reason, 'Owned', 'owned');
UPDATE "user_to_entity"
SET media_reason = array_replace(media_reason, 'Monitoring', 'monitoring');
UPDATE "user_to_entity"
SET media_reason = array_replace(media_reason, 'Watchlist', 'watchlist');
        "#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
