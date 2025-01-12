use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if !manager
            .has_column("import_report", "estimated_finish_time")
            .await?
        {
            db.execute_unprepared(
                r#"
ALTER TABLE "import_report" ADD COLUMN "estimated_finish_time" timestamp with time zone;
UPDATE "import_report" SET "estimated_finish_time" = ("started_on" + interval '1 hour');
ALTER TABLE "import_report" ALTER COLUMN "estimated_finish_time" SET NOT NULL;
                "#,
            )
            .await?;
        }
        for enum_name in ["ReviewConversion", "SeenHistoryConversion"] {
            db.execute_unprepared(&format!(
                r#"
UPDATE import_report
SET details = jsonb_set(
    details,
    '{{failed_items}}',
    (
        SELECT jsonb_agg(
            CASE
                WHEN (failed_item ->> 'step') = '{enum_name}' THEN
                    jsonb_set(failed_item, '{{step}}', '"DatabaseCommit"')
                ELSE
                    failed_item
            END
        )
        FROM jsonb_array_elements(details -> 'failed_items') AS failed_item
    )
)
WHERE details -> 'failed_items' @> '[{{"step": "{enum_name}"}}]';
        "#,
            ))
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
