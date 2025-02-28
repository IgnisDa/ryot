use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if !manager
            .has_column("notification_platform", "configured_events")
            .await?
        {
            db.execute_unprepared(
                r#"
ALTER TABLE "notification_platform" ADD COLUMN "configured_events" TEXT[];

UPDATE notification_platform un
SET "configured_events" = ARRAY(
    SELECT jsonb_array_elements_text(u.preferences->'notifications'->'to_send')
    FROM "user" u
    WHERE u.id = un.user_id
);

ALTER TABLE "notification_platform" ALTER COLUMN "configured_events" SET NOT NULL;
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
