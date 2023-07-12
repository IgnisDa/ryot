use sea_orm_migration::prelude::*;

use super::{Review, Seen};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230712_000016_remove_identifier_fields"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let alias = Alias::new("identifier");
        manager
            .alter_table(
                Table::alter()
                    .table(Review::Table)
                    .drop_column(alias.clone())
                    .to_owned(),
            )
            .await
            .ok();
        manager
            .alter_table(
                Table::alter()
                    .table(Seen::Table)
                    .drop_column(alias.clone())
                    .to_owned(),
            )
            .await
            .ok();
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
