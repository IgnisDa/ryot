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

alter table import_report rename constraint media_import_report_pkey to import_report_pkey;
"#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
