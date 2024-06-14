use nanoid::nanoid;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(&format!(
            r#"
DO $$
DECLARE
    user_rec RECORD;
BEGIN
    FOR user_rec IN SELECT id FROM "user"
    LOOP
        INSERT INTO collection (name, description, user_id, created_on, last_updated_on, id)
        VALUES (
            'Recommendations', 'Items that are recommended to me based on my consumption.',
            user_rec.id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'col_{id}'
        )
        ON CONFLICT DO NOTHING;
    END LOOP;
END $$;
            "#,
            id = nanoid!(12),
        ))
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
