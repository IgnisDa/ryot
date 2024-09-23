use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
ALTER TABLE "daily_user_activity" DROP COLUMN IF EXISTS "anime_episode_count";
ALTER TABLE "daily_user_activity" DROP COLUMN IF EXISTS "manga_chapter_count";
ALTER TABLE "daily_user_activity" DROP COLUMN IF EXISTS "manga_volume_count";
ALTER TABLE "daily_user_activity" DROP COLUMN IF EXISTS "show_season_count";
ALTER TABLE "daily_user_activity" DROP COLUMN IF EXISTS "show_episode_count";
"#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
