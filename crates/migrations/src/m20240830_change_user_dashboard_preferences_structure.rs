use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
UPDATE "user" SET "preferences" = jsonb_set("preferences", '{general,dashboard}', '{"summary": {"index": 2, "settings": false, "is_hidden": false}, "activity": {"index": 4, "settings": false, "is_hidden": false}, "upcoming": {"index": 0, "settings": {"num_elements": 8}, "is_hidden": false}, "in_progress": {"index": 1, "settings": {"num_elements": 8}, "is_hidden": false}, "recommendations": {"index": 3, "settings": {"num_elements": 8}, "is_hidden": false}}');
"#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
