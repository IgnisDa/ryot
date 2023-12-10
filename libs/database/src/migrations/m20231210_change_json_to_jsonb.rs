use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

async fn change_column_from_json_to_jsonb<'a>(
    manager: &'a SchemaManager<'a>,
    table: &str,
    column: &str,
) -> Result<(), DbErr> {
    let db = manager.get_connection();
    db.execute_unprepared(&format!(
        r#"
alter table "{table}" add column "{column}_jsonb" jsonb;
update "{table}" set "{column}_jsonb" = "{column}"::jsonb;
alter table "{table}" drop column "{column}";
alter table "{table}" rename column "{column}_jsonb" to "{column}";
"#,
    ))
    .await?;
    Ok(())
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let columns = vec![
            ("metadata", "images"),
            ("metadata", "videos"),
            ("metadata", "specifics"),
            ("metadata", "free_creators"),
            ("person", "images"),
            ("user", "preferences"),
            ("user", "yank_integrations"),
            ("user", "sink_integrations"),
            ("user", "notifications"),
            ("user", "summary"),
            ("seen", "extra_information"),
            ("review", "comments"),
            ("review", "extra_information"),
            ("import_report", "details"),
            ("exercise", "muscles"),
            ("exercise", "attributes"),
            ("user_measurement", "stats"),
            ("workout", "summary"),
            ("workout", "information"),
            ("metadata_group", "images"),
            ("user_to_entity", "metadata_ownership"),
            ("user_to_entity", "exercise_extra_information"),
        ];
        for (table, column) in columns {
            change_column_from_json_to_jsonb(manager, table, column).await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
