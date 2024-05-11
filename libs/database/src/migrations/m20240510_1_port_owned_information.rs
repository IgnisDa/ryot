use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager
            .has_column("user_to_entity", "media_ownership")
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
            'Owned', 'Items that I have in my inventory.', user_rec.id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
            '[{"name": "Owned on", "description": "When did you get this media?", "lot": "Date"}]'
        )
        ON CONFLICT DO NOTHING;

        INSERT INTO user_to_collection (user_id, collection_id)
        SELECT user_rec.id, id FROM collection
        WHERE user_id = user_rec.id AND name = 'Owned' LIMIT 1;
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
    owned_collection_id INTEGER;
BEGIN
    FOR user_rec IN SELECT id FROM "user"
    LOOP
        FOR ute IN (
            SELECT metadata_id, media_ownership FROM "user_to_entity" WHERE media_ownership
            IS NOT NULL AND user_id = user_rec.id ORDER BY last_updated_on DESC
        )
        LOOP
            SELECT id INTO owned_collection_id FROM collection
            WHERE user_id = user_rec.id AND name = 'Owned' LIMIT 1;

            INSERT INTO collection_to_entity (collection_id, metadata_id, information)
            VALUES (
                owned_collection_id, ute.metadata_id,
                CASE WHEN ute.media_ownership ->> 'owned_on' IS NULL THEN '{}'::jsonb ELSE
                JSONB_BUILD_OBJECT('Owned on', ute.media_ownership -> 'owned_on') END
            );
        END LOOP;
    END LOOP;
END $$;
            "#,
            )
            .await?;
            db.execute_unprepared(
                r#"
ALTER TABLE "user_to_entity" DROP COLUMN media_ownership;
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
