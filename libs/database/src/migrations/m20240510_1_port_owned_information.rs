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

        INSERT INTO user_to_collection (user_id, collection_id)
        SELECT aUser.id, id FROM collection
        WHERE user_id = aUser.id AND name = 'Owned' LIMIT 1;
    END LOOP;
END $$;
            "#,
        )
        .await?;
        db.execute_unprepared(
            r#"
DO $$
DECLARE
    aUser RECORD;
    ute RECORD;
    owned_collection_id INTEGER;
BEGIN
    FOR aUser IN SELECT id FROM "user"
    LOOP
        FOR ute IN SELECT metadata_id FROM "user_to_entity" where media_ownership is not null and user_id = aUser.id
        LOOP
            SELECT id INTO owned_collection_id FROM collection
            WHERE user_id = aUser.id AND name = 'Owned' LIMIT 1;

            INSERT INTO collection_to_entity (collection_id, metadata_id)
            VALUES (owned_collection_id, ute.metadata_id);
        END LOOP;
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
