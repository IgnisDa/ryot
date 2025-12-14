use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared(
            r#"
UPDATE "user_to_entity" SET "exercise_extra_information" = JSONB_SET(
    "exercise_extra_information",
    '{settings,default_duration_unit}',
    '"minutes"'::jsonb
)
WHERE "exercise_extra_information" -> 'settings' IS NOT NULL
"#,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
