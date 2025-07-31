use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
ALTER TABLE calendar_event ALTER COLUMN "date" SET NOT NULL;

ALTER TABLE collection_to_entity ALTER COLUMN "entity_id" SET NOT NULL;
ALTER TABLE collection_to_entity ALTER COLUMN "entity_lot" SET NOT NULL;

ALTER TABLE exercise ALTER COLUMN "muscles" SET NOT NULL;

-- Drop the old FK constraint from exercise table if it exists
ALTER TABLE exercise DROP CONSTRAINT IF EXISTS workout_to_user_foreign_key;

-- Add the new FK constraint to exercise table if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'exercise_to_user_foreign_key'
    ) THEN
        ALTER TABLE exercise ADD CONSTRAINT exercise_to_user_foreign_key 
        FOREIGN KEY (created_by_user_id) REFERENCES "user"(id) 
        ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
END $$;

ALTER TABLE review ALTER COLUMN "entity_lot" SET NOT NULL;
        "#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
