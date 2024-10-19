use sea_orm_migration::prelude::*;

use crate::m20240904_create_monitored_entity::MONITORED_ENTITY_VIEW_CREATION_SQL;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(r#"DROP VIEW "monitored_entity""#)
            .await?;
        db.execute_unprepared(MONITORED_ENTITY_VIEW_CREATION_SQL)
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
