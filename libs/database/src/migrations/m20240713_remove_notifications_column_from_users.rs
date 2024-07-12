use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
INSERT INTO notification_platform (user_id, id, platform_specifics, platform, created_on)
SELECT
    u.id AS user_id,
    (u.id || '_' || (n->>'id')) as id,
    (n->'settings') AS platform_specifics,
    lower(n->'settings'->>'t') AS platform,
    (n->>'timestamp')::timestamp with time zone AS created_on
FROM
    "user" u,
    jsonb_array_elements(u.notifications) AS n
WHERE
    jsonb_array_length(u.notifications) > 0;
        "#,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
