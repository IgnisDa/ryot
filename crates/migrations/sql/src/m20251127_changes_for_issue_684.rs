use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared(
            r#"
UPDATE "user" SET "preferences" =
JSONB_SET("preferences", '{languages}', '{"providers":[{"source":"anilist","preferred_language":"user_preferred"},{"source":"tvdb","preferred_language":"eng"},{"source":"audible","preferred_language":"US"},{"source":"itunes","preferred_language":"en_us"},{"source":"tmdb","preferred_language":"en"},{"source":"youtube_music","preferred_language":"en"}]}'::jsonb)
WHERE "preferences"->'languages' IS NULL
"#,
        )
        .await?;

        db.execute_unprepared(
            r#"alter table metadata_to_metadata_group alter column part drop not null"#,
        )
        .await?;

        if !manager
            .has_column("metadata_group", "last_updated_on")
            .await?
        {
            db.execute_unprepared(
            r#"ALTER TABLE "metadata_group" ADD COLUMN "last_updated_on" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP"#,
        )
        .await?;
        }

        for entity in &["person", "metadata_group", "metadata"] {
            if !manager
                .has_column(entity, "has_translations_for_languages")
                .await?
            {
                db.execute_unprepared(&format!(
                    r#"ALTER TABLE "{}" ADD COLUMN "has_translations_for_languages" text[]"#,
                    entity
                ))
                .await?;
            }
        }

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
