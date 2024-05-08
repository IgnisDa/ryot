use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
DO $$
DECLARE
    col RECORD;
BEGIN
    FOR col IN SELECT id, created_by_user_id FROM "collection"
    LOOP
        INSERT INTO "user_to_collection" (user_id, collection_id)
        VALUES (col.created_by_user_id, col.id)
        ON CONFLICT DO NOTHING;
    END LOOP;
END $$;
        "#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
