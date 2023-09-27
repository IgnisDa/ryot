use sea_orm_migration::prelude::*;

use super::m20230413_create_person::{Person, PERSON_IDENTIFIER_UNIQUE_KEY};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(Index::drop().name(PERSON_IDENTIFIER_UNIQUE_KEY).to_owned())
            .await?;
        manager
            .create_index(
                Index::create()
                    .unique()
                    .name(PERSON_IDENTIFIER_UNIQUE_KEY)
                    .table(Person::Table)
                    .col(Person::Identifier)
                    .col(Person::Source)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
