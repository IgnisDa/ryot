use sea_orm_migration::prelude::*;

use crate::{
    m20231016_create_collection_to_entity::{CONSTRAINT_SQL, ENTITY_ID_SQL, ENTITY_LOT_SQL},
    m20240904_create_monitored_entity::MONITORED_ENTITY_VIEW_CREATION_SQL,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
ALTER TABLE "metadata" ADD COLUMN IF NOT EXISTS "is_recommendation" BOOLEAN;
ALTER TABLE "seen" ADD COLUMN IF NOT EXISTS "manual_time_spent" NUMERIC;
ALTER TABLE "integration" ADD COLUMN IF NOT EXISTS "sync_to_owned_collection" BOOLEAN;

UPDATE "user" SET "preferences" = jsonb_set("preferences", '{features_enabled,fitness,templates}', 'true');
"#,
        )
        .await?;
        if !manager.has_column("workout", "template_id").await? {
            db.execute_unprepared(
            r#"
ALTER TABLE "workout" ADD COLUMN "template_id" TEXT;
ALTER TABLE "workout" ADD CONSTRAINT "template_to_workout_foreign_key" FOREIGN KEY ("template_id") REFERENCES "workout_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;
"#,
        )
        .await?;
        }
        if !manager
            .has_column("collection_to_entity", "workout_template_id")
            .await?
        {
            db.execute_unprepared(
            r#"
ALTER TABLE "collection_to_entity" ADD COLUMN "workout_template_id" TEXT;
ALTER TABLE "collection_to_entity" ADD CONSTRAINT "collection_to_entity-fk7" FOREIGN KEY ("workout_template_id") REFERENCES "workout_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "collection_to_entity_uqi6" ON "collection_to_entity" ("collection_id", "workout_template_id");
"#,
        )
        .await?;
        }
        db.execute_unprepared(r#"DROP VIEW "monitored_entity""#)
            .await?;
        db.execute_unprepared(CONSTRAINT_SQL).await?;
        db.execute_unprepared(&format!(
            r#"
        ALTER TABLE "collection_to_entity" DROP COLUMN "entity_lot";
        ALTER TABLE "collection_to_entity" ADD COLUMN "entity_lot" TEXT {};
        "#,
            ENTITY_LOT_SQL
        ))
        .await?;
        db.execute_unprepared(&format!(
            r#"
ALTER TABLE "collection_to_entity" DROP COLUMN "entity_id";
ALTER TABLE "collection_to_entity" ADD COLUMN "entity_id" TEXT {};
"#,
            ENTITY_ID_SQL
        ))
        .await?;
        db.execute_unprepared(MONITORED_ENTITY_VIEW_CREATION_SQL)
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
