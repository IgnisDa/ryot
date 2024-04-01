use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(r#"
DO $$
DECLARE
    aUser RECORD;
BEGIN
    FOR aUser IN SELECT id FROM "user"
    LOOP
        INSERT INTO collection (name, description, user_id, visibility, created_on, last_updated_on)
        VALUES ('Monitoring', 'Items that I am keeping an eye on.', aUser.id, 'PR', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    END LOOP;
END $$;
        "#)
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
