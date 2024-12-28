use sea_orm_migration::prelude::*;

use crate::m20230413_create_person::create_metadata_group_to_person_table;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if !manager.has_table("metadata_group_to_person").await? {
            create_metadata_group_to_person_table(manager).await?;
        }
        db.execute_unprepared(
            r#"
UPDATE
  "user"
SET
  preferences = JSONB_SET(
    preferences,
    '{notifications,to_send}',
    (
      (preferences -> 'notifications' -> 'to_send')
        || '"PersonMetadataAssociated"' || '"PersonMetadataGroupAssociated"'
    ) - 'PersonMediaAssociated'
  )
WHERE
  preferences -> 'notifications' -> 'to_send' ? 'PersonMediaAssociated'
            "#,
        )
        .await?;
        db.execute_unprepared(
            r#"
UPDATE
  "person"
SET
  "state_changes" = JSONB_SET(
    JSONB_SET("state_changes", '{metadata_associated}', "state_changes"->'media_associated') - 'media_associated',
    '{metadata_groups_associated}',
    '[]'
  )
WHERE
  "state_changes"->'media_associated' is not null;
"#,
        )
        .await?;
        db.execute_unprepared(r#"ALTER TABLE "metadata_group" ALTER COLUMN "parts" SET DEFAULT 0"#)
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
