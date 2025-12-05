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
JSONB_SET("preferences", '{languages}', '{"providers":[{"source":"anilist","preferred_language":"user_preferred"},{"source":"tvdb","preferred_language":"eng"},{"source":"audible","preferred_language":"US"},{"source":"itunes","preferred_language":"en_us"},{"source":"tmdb","preferred_language":"en"},{"source":"youtube_music","preferred_language":"English (US)"}]}'::jsonb)
WHERE "preferences"->'languages' IS NULL
"#,
        )
        .await?;

        if !manager
            .has_column("metadata", "has_translations_for_languages")
            .await?
        {
            db.execute_unprepared(
                "alter table metadata add column has_translations_for_languages jsonb",
            )
            .await?;
        }

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
