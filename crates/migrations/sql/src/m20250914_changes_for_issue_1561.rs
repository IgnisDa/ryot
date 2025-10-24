use sea_orm_migration::prelude::*;

use crate::m20250827_create_enriched_user_to_entity_views::ENRICHED_USER_TO_METADATA_VIEW_CREATION_SQL;

use super::{
    m20230411_create_metadata_group::METADATA_GROUP_TO_USER_FOREIGN_KEY,
    m20230413_create_person::PERSON_TO_USER_FOREIGN_KEY,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        if !manager.has_column("person", "created_by_user_id").await? {
            db.execute_unprepared(&format!(
                r#"
ALTER TABLE "person" ADD COLUMN "created_by_user_id" TEXT;

ALTER TABLE "person" ADD CONSTRAINT "{PERSON_TO_USER_FOREIGN_KEY}"
FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE SET NULL;
"#
            ))
            .await?;
        }

        if !manager
            .has_column("metadata_group", "created_by_user_id")
            .await?
        {
            db.execute_unprepared(&format!(
                r#"
ALTER TABLE "metadata_group" ADD COLUMN "created_by_user_id" TEXT;

ALTER TABLE "metadata_group" ADD CONSTRAINT "{METADATA_GROUP_TO_USER_FOREIGN_KEY}"
FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE SET NULL;
"#
            ))
            .await?;
        }

        db.execute_unprepared("DROP VIEW enriched_user_to_metadata")
            .await?;
        db.execute_unprepared(ENRICHED_USER_TO_METADATA_VIEW_CREATION_SQL)
            .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
