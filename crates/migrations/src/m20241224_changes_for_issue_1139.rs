use sea_orm_migration::prelude::*;

use crate::m20230410_create_metadata::METADATA_TO_USER_FOREIGN_KEY;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if !manager.has_column("metadata", "created_by_user_id").await? {
            db.execute_unprepared(&format!(
            r#"
ALTER TABLE "metadata" ADD COLUMN "created_by_user_id" TEXT;
ALTER TABLE "metadata" ADD CONSTRAINT "{fk}" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        "#,
        fk = METADATA_TO_USER_FOREIGN_KEY
        ))
        .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
