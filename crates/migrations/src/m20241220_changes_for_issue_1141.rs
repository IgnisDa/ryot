use sea_orm_migration::prelude::*;

use crate::m20240827_create_daily_user_activity::{
    DailyUserActivity, DAILY_USER_ACTIVITY_COMPOSITE_UNIQUE_KEY,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
UPDATE "user"
SET "preferences" = jsonb_set(
    "preferences",
    '{fitness,logging,prompt_for_rest_timer}',
    'false'
);

--

ALTER TABLE "workout" DROP COLUMN "duration";
ALTER TABLE "workout" ADD COLUMN "duration" INTEGER;
UPDATE "workout" SET "duration" = extract(epoch FROM "end_time" - "start_time");
ALTER TABLE "workout" ALTER COLUMN "duration" SET NOT NULL;

--

DELETE FROM "daily_user_activity";

--

DELETE FROM "application_cache";
ALTER TABLE "application_cache" ADD COLUMN "version" TEXT NOT NULL;
        "#,
        )
        .await?;
        manager
            .drop_index(
                Index::drop()
                    .name(DAILY_USER_ACTIVITY_COMPOSITE_UNIQUE_KEY)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name(DAILY_USER_ACTIVITY_COMPOSITE_UNIQUE_KEY)
                    .unique()
                    .nulls_not_distinct()
                    .table(DailyUserActivity::Table)
                    .col(DailyUserActivity::UserId)
                    .col(DailyUserActivity::Date)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
