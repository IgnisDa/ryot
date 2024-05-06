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
    user_rec RECORD;
    seen_rec RECORD;
    done_collection_id INTEGER;
BEGIN
    FOR user_rec IN SELECT id FROM "user"
    LOOP
      SELECT id INTO done_collection_id FROM collection
      WHERE user_id = user_rec.id AND name = 'Done' LIMIT 1;

      FOR seen_rec IN SELECT metadata_id FROM seen WHERE user_id = user_rec.id AND progress = 100
      LOOP
          INSERT INTO collection_to_entity (collection_id, metadata_id)
          VALUES (done_collection_id, seen_rec.metadata_id)
          ON CONFLICT DO NOTHING;
      END LOOP;
    END LOOP;
END$$;
        "#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
