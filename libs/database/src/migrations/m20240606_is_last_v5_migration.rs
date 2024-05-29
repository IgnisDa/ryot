use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(r#"
UPDATE "user" SET "summary" = '{"media": {"anime": {"watched": 0, "episodes": 0}, "books": {"read": 0, "pages": 0}, "manga": {"read": 0, "chapters": 0}, "shows": {"runtime": 0, "watched": 0, "watched_seasons": 0, "watched_episodes": 0}, "movies": {"runtime": 0, "watched": 0}, "podcasts": {"played": 0, "runtime": 0, "played_episodes": 0}, "audio_books": {"played": 0, "runtime": 0}, "video_games": {"played": 0}, "visual_novels": {"played": 0, "runtime": 0}, "people_overall": {"reviewed": 0, "interacted_with": 0}, "metadata_overall": {"reviewed": 0, "interacted_with": 0}}, "fitness": {"workouts": {"weight": "0", "duration": "0", "recorded": 0}, "measurements_recorded": 0, "exercises_interacted_with": 0}, "unique_items": {"anime": [], "books": [], "manga": [], "shows": [], "movies": [], "podcasts": [], "audio_books": [], "video_games": [], "show_seasons": [], "manga_volumes": [], "show_episodes": [], "visual_novels": [], "anime_episodes": [], "manga_chapters": [], "podcast_episodes": []}, "calculated_on": "1990-01-01T18:30:31.620637675Z", "calculated_from_beginning": false}';
        "#).await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
