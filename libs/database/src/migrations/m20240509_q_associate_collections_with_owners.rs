use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column("collection", "user_id").await? {
            let db = manager.get_connection();
            db.execute_unprepared(
                r#"
DO $$
DECLARE
    col RECORD;
BEGIN
FOR col IN SELECT id, user_id FROM "collection"
    LOOP
        INSERT INTO "user_to_collection" (user_id, collection_id, creator)
        VALUES (col.user_id, col.id, true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END $$;
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
