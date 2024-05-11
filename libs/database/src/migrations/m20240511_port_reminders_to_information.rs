use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager
            .has_column("user_to_entity", "media_reminder")
            .await?
        {
            let db = manager.get_connection();
            db.execute_unprepared(
            r#"
DO $$
DECLARE
    user_rec RECORD;
BEGIN
    FOR user_rec IN SELECT id FROM "user"
    LOOP
        INSERT INTO collection (name, description, user_id, created_on, last_updated_on, information_template)
        VALUES (
            'Reminders', 'Items that I want to be reminded about.', user_rec.id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
            '[
                {"name": "Reminder", "description": "When do you want to be reminded?", "lot": "Date", "required": true},
                {"name": "Text", "description": "What do you want to be reminded about?", "lot": "String", "required": true}
            ]'
        )
        ON CONFLICT DO NOTHING;

        INSERT INTO user_to_collection (user_id, collection_id)
        SELECT user_rec.id, id FROM collection
        WHERE user_id = user_rec.id AND name = 'Reminders' LIMIT 1;
    END LOOP;
END $$;
            "#,
        )
        .await?;
            db.execute_unprepared(
                r#"
DO $$
DECLARE
    user_rec RECORD;
    ute RECORD;
    reminder_collection_id INTEGER;
BEGIN
    FOR user_rec IN SELECT id FROM "user"
    LOOP
        FOR ute IN (
            SELECT metadata_id, media_reminder FROM "user_to_entity" WHERE media_reminder
            IS NOT NULL AND user_id = user_rec.id ORDER BY last_updated_on DESC
        )
        LOOP
            SELECT id INTO reminder_collection_id FROM collection
            WHERE user_id = user_rec.id AND name = 'Reminder' LIMIT 1;

            INSERT INTO collection_to_entity (collection_id, metadata_id, information)
            VALUES (
                reminder_collection_id, ute.metadata_id, JSONB_BUILD_OBJECT('Reminder',
                ute.media_reminder -> 'remind_on', 'Text', ute.media_reminder -> 'message')
            );
        END LOOP;
    END LOOP;
END $$;
            "#,
            )
            .await?;
            db.execute_unprepared(
                r#"
ALTER TABLE "user_to_entity" DROP COLUMN media_reminder;
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
