use sea_orm_migration::prelude::*;

use crate::m20240827_create_daily_user_activity::create_daily_user_activity_table;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if !manager.has_column("metadata", "music_specifics").await? {
            db.execute_unprepared("ALTER TABLE metadata ADD COLUMN music_specifics JSONB")
                .await?;
        }
        if !manager
            .has_column("daily_user_activity", "music_count")
            .await?
        {
            db.execute_unprepared("DROP TABLE daily_user_activity")
                .await?;
            create_daily_user_activity_table(manager).await?;
        }
        db.execute_unprepared(r#"UPDATE "user" SET preferences = jsonb_set(preferences, '{features_enabled,media,music}', 'true', true)"#)
                .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
