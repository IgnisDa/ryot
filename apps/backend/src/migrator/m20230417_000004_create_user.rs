use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

static USER_NAME_INDEX: &str = "user__name__index";

pub struct Migration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize)]
#[sea_orm(rs_type = "String", db_type = "String(Some(1))")]
pub enum TokenLot {
    #[sea_orm(string_value = "A")]
    ApiAccess,
    #[sea_orm(string_value = "L")]
    Login,
}

#[derive(Iden)]
enum Token {
    Table,
    Id,
    UserId,
    Lot,
    CreatedOn,
    LastUsed,
    Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize)]
#[sea_orm(rs_type = "String", db_type = "String(Some(1))")]
pub enum UserLot {
    #[sea_orm(string_value = "A")]
    Admin,
    #[sea_orm(string_value = "N")]
    Normal,
}

#[derive(Iden)]
pub enum User {
    Table,
    Id,
    Name,
    Password,
    Lot,
}

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230417_000004_create_user"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Token::Table)
                    .col(
                        ColumnDef::new(Token::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Token::Value).string().not_null())
                    .col(
                        ColumnDef::new(Token::Lot)
                            .enumeration(TokenLotEnum.into_iden(), TokenLotEnum.into_iter())
                            .not_null(),
                    )
                    .col(ColumnDef::new(Token::UserId).integer().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("user-to-token_foreign_key")
                            .from(Token::Table, Token::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(
                        ColumnDef::new(Token::CreatedOn)
                            .date_time()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(Token::LastUsed).date_time())
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(User::Table)
                    .col(
                        ColumnDef::new(User::Id)
                            .primary_key()
                            .auto_increment()
                            .integer()
                            .not_null(),
                    )
                    .col(ColumnDef::new(User::Name).unique_key().string().not_null())
                    .col(ColumnDef::new(User::Password).string().not_null())
                    .col(
                        ColumnDef::new(User::Lot)
                            .enumeration(UserLotEnum.into_iden(), UserLotEnum.into_iter())
                            .default(UserLot::Admin)
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name(USER_NAME_INDEX)
                    .table(User::Table)
                    .col(User::Name)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Token::Table).to_owned())
            .await?;
        manager
            .drop_index(Index::drop().name(USER_NAME_INDEX).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(User::Table).to_owned())
            .await?;
        Ok(())
    }
}
