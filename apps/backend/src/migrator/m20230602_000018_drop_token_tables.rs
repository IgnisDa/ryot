use sea_orm_migration::prelude::*;

use super::m20230417_000004_create_user::Token;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230602_000018_drop_token_tables"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Token::Table).cascade().to_owned())
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
