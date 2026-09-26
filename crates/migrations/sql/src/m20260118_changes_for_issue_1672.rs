use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared(
            r#"
ALTER TABLE person DROP COLUMN IF EXISTS "has_translations_for_languages";
ALTER TABLE metadata DROP COLUMN IF EXISTS "has_translations_for_languages";
ALTER TABLE metadata_group DROP COLUMN IF EXISTS "has_translations_for_languages";

ALTER TABLE entity_translation ADD COLUMN IF NOT EXISTS "show_extra_information" JSONB;
ALTER TABLE entity_translation ADD COLUMN IF NOT EXISTS "podcast_extra_information" JSONB;

DROP INDEX IF EXISTS "entity_translation__language_metadata_id_variant_idx";
CREATE UNIQUE INDEX "entity_translation__language_metadata_id_variant_idx"
ON "entity_translation" ("language", "metadata_id", "variant", "show_extra_information", "podcast_extra_information")
NULLS NOT DISTINCT
WHERE "metadata_id" IS NOT NULL;
            "#,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
