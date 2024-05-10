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
    aUser RECORD;
BEGIN
    FOR aUser IN SELECT id FROM "user"
    LOOP
        INSERT INTO collection (name, description, user_id, created_on, last_updated_on, information_template)
        VALUES (
            'Owned', 'Items that I have in my inventory.', aUser.id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
            '[{"name": "owned_on", "description": "When did you get this media?", "lot": "Date", "required": true}]'
        )
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
