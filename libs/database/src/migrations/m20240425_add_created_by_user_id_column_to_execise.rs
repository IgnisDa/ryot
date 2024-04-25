use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("exercise", "created_by_user_id").await? {
            let db = manager.get_connection();
            db.execute_unprepared(r#"ALTER TABLE exercise ADD COLUMN created_by_user_id INTEGER;"#)
                .await?;
            db.execute_unprepared(r#"UPDATE exercise SET created_by_user_id = (SELECT id FROM "user" WHERE lot = 'A' LIMIT 1) WHERE source = 'CU';"#)
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
