use sea_orm_migration::prelude::*;

use crate::m20240827_create_daily_user_activity::DAILY_USER_ACTIVITY_COMPOSITE_UNIQUE_KEY;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(&format!(
            r#"
UPDATE "user"
SET "preferences" = jsonb_set(
    "preferences",
    '{{fitness,logging,prompt_for_rest_timer}}',
    'false'
);

--

ALTER TABLE "workout" DROP COLUMN "duration";
ALTER TABLE "workout" ADD COLUMN "duration" INTEGER;
UPDATE "workout" SET "duration" = extract(epoch FROM "end_time" - "start_time");
ALTER TABLE "workout" ALTER COLUMN "duration" SET NOT NULL;

--

DELETE FROM "daily_user_activity";
DROP INDEX "{dua_idx}";
CREATE UNIQUE INDEX "{dua_idx}" ON "daily_user_activity"("user_id", "date") NULLS NOT DISTINCT;
--

DELETE FROM "application_cache";
ALTER TABLE "application_cache" ADD COLUMN "version" TEXT NOT NULL;
        "#,
            dua_idx = DAILY_USER_ACTIVITY_COMPOSITE_UNIQUE_KEY
        ))
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
