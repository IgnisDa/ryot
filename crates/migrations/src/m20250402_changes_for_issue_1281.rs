use sea_orm::{DbBackend, Statement};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let sql = r#"
            UPDATE "user"
            SET preferences = jsonb_set(
                preferences,
                '{general,dashboard}',
                (
                    SELECT jsonb_agg(
                        CASE
                            WHEN element->>'section' = 'TRENDING' THEN element
                            ELSE element
                        END
                    )
                    FROM jsonb_array_elements(preferences->'general'->'dashboard') as element
                ) || jsonb_build_array(
                    jsonb_build_object(
                        'hidden', false,
                        'section', 'TRENDING',
                        'numElements', 8
                    )
                )
            )
            WHERE NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements(preferences->'general'->'dashboard') as element
                WHERE element->>'section' = 'TRENDING'
            );
        "#;
        let stmt = Statement::from_string(DbBackend::Postgres, sql.to_owned());
        manager.get_connection().execute(stmt).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let sql = r#"
            UPDATE "user"
            SET preferences = jsonb_set(
                preferences,
                '{general,dashboard}',
                (
                    SELECT jsonb_agg(element)
                    FROM jsonb_array_elements(preferences->'general'->'dashboard') as element
                    WHERE element->>'section' != 'TRENDING'
                )
            );
        "#;
        let stmt = Statement::from_string(DbBackend::Postgres, sql.to_owned());
        manager.get_connection().execute(stmt).await?;
        Ok(())
    }
}
