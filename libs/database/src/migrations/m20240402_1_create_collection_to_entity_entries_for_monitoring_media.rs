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
    user_rec RECORD;
    monitored_entities RECORD;
    monitoring_collection_id INTEGER;
BEGIN
    FOR user_rec IN SELECT id FROM "user"
    LOOP
        SELECT id INTO monitoring_collection_id FROM collection
        WHERE user_id = user_rec.id AND name = 'Monitoring' LIMIT 1;

        FOR monitored_entities IN SELECT id, metadata_id, person_id, metadata_group_id, exercise_id FROM user_to_entity
        WHERE user_id = user_rec.id AND media_monitored = true
        LOOP
            INSERT INTO collection_to_entity (collection_id, metadata_id, person_id, metadata_group_id, exercise_id)
            VALUES (monitoring_collection_id, monitored_entities.metadata_id, monitored_entities.person_id, monitored_entities.metadata_group_id, monitored_entities.exercise_id)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END$$;
        "#)
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
