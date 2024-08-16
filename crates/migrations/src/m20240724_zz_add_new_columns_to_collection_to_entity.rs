use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager
            .has_column("collection_to_entity", "workout_template_id")
            .await?
        {
            let db = manager.get_connection();
            db.execute_unprepared(
                r#"
ALTER TABLE "collection_to_entity" ADD COLUMN "workout_template_id" TEXT;
ALTER TABLE "collection_to_entity" ADD CONSTRAINT "collection_to_entity-fk7" FOREIGN KEY ("workout_template_id") REFERENCES "workout_template" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "collection_to_entity_uqi6" ON "collection_to_entity" ("collection_id", "workout_template_id");
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
