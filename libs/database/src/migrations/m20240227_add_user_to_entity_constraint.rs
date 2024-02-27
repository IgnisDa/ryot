use sea_orm_migration::prelude::*;

use super::m20231017_create_user_to_entity::CONSTRAINT_SQL;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"alter table "user_to_entity" drop constraint if exists "user_to_entity__ensure_one_entity""#,
        )
        .await?;
        db.execute_unprepared(CONSTRAINT_SQL).await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
