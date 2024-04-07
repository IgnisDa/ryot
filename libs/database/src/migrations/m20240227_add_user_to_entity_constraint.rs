use sea_orm_migration::prelude::*;

use super::m20231017_create_user_to_entity::CONSTRAINT_SQL;

#[derive(DeriveMigrationName)]
pub struct Migration;

static OLD_CONSTRAINT_SQL: &str = r#"
ALTER TABLE "user_to_entity"
ADD CONSTRAINT "user_to_entity__ensure_one_entity"
CHECK (
    (CASE WHEN "metadata_id" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "person_id" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "exercise_id" IS NOT NULL THEN 1 ELSE 0 END)
    = 1
);
"#;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"alter table "user_to_entity" drop constraint if exists "user_to_entity__ensure_one_entity""#,
        )
        .await?;
        if manager
            .has_column("user_to_entity", "metadata_group_id")
            .await?
        {
            db.execute_unprepared(CONSTRAINT_SQL).await?;
        } else {
            db.execute_unprepared(OLD_CONSTRAINT_SQL).await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
