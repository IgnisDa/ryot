// DEV: This migration is meant to migrate the schema such that exisiting instances have
// the same schema as the new instances.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
alter table seen alter column state set default 'IP'::text;
alter table review alter column visibility set default 'PR'::text;
alter table collection alter column visibility set default 'PR'::text;

alter sequence if exists media_import_report_id_seq rename to import_report_id_seq;

alter table "user" alter column preferences set not null;
alter table user_measurement alter column stats set not null;
alter table exercise alter column muscles set not null;
alter table exercise alter column attributes set not null;
alter table metadata_group alter column images set not null;
alter table review alter column comments set not null;
alter table workout alter column summary set not null;
alter table workout alter column information set not null;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'media_import_report_pkey'
        AND table_name = 'import_report'
    ) THEN
        EXECUTE 'ALTER TABLE import_report RENAME CONSTRAINT media_import_report_pkey TO import_report_pkey;';
    END IF;
END
$$;
"#,
        )
        .await?;
        if manager
            .has_column("user_to_entity", "metadata_reminder")
            .await?
        {
            db.execute_unprepared(
                "alter table user_to_entity alter column metadata_reminder type jsonb",
            )
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
