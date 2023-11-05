use sea_orm::DatabaseBackend;
use sea_orm_migration::prelude::*;

use super::m20230912_create_calendar_event::{CalendarEvent, UNIQUE_KEY};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !matches!(manager.get_database_backend(), DatabaseBackend::Postgres) {
            return Err(DbErr::Custom("Only Postgres will be support by Ryot, please revert to a previous version and switch your database.".to_owned()));
        }
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
update calendar_event set metadata_extra_information = '{"Other":null}' where metadata_extra_information = '"Other"';
alter table calendar_event add column mei_json jsonb;
update calendar_event set mei_json = metadata_extra_information::jsonb;
alter table calendar_event drop column metadata_extra_information;
alter table calendar_event rename column mei_json to metadata_extra_information;
"#,
        )
        .await?;
        manager
            .create_index(
                Index::create()
                    .unique()
                    .name(UNIQUE_KEY)
                    .table(CalendarEvent::Table)
                    .col(CalendarEvent::Date)
                    .col(CalendarEvent::MetadataId)
                    .col(CalendarEvent::MetadataExtraInformation)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
