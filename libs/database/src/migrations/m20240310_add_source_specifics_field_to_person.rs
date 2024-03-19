use sea_orm_migration::prelude::*;

use super::m20230413_create_person::{Person, PERSON_IDENTIFIER_UNIQUE_KEY};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("person", "source_specifics").await? {
            let db = manager.get_connection();
            db.execute_unprepared(&format!(
                r#"
alter table person add column source_specifics jsonb;
drop index if exists "{}";
"#,
                PERSON_IDENTIFIER_UNIQUE_KEY
            ))
            .await?;
            manager
                .create_index(
                    Index::create()
                        .unique()
                        .name(PERSON_IDENTIFIER_UNIQUE_KEY)
                        .table(Person::Table)
                        .col(Person::Identifier)
                        .col(Person::Source)
                        .col(Person::SourceSpecifics)
                        .nulls_not_distinct()
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
