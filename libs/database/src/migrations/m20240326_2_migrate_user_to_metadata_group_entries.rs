use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
INSERT INTO user_to_entity (user_id, metadata_group_id, created_on, last_updated_on)
SELECT DISTINCT r.user_id, r.metadata_group_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM review r
WHERE r.metadata_group_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM user_to_entity ute
    WHERE ute.user_id = r.user_id AND ute.metadata_group_id = r.metadata_group_id
  );
"#,
        )
        .await?;
        db.execute_unprepared(
            r#"
INSERT INTO user_to_entity (user_id, metadata_group_id, created_on, last_updated_on)
SELECT DISTINCT c.user_id, cte.metadata_group_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM collection_to_entity cte
JOIN collection c ON cte.collection_id = c.id
WHERE cte.metadata_group_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM user_to_entity ute
    WHERE ute.user_id = c.user_id AND ute.metadata_group_id = cte.metadata_group_id
  );
"#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
