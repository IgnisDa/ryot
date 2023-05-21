use sea_orm_migration::prelude::*;

use super::m20230417_000004_create_user::User;

pub struct Migration;

#[derive(Iden)]
pub enum Summary {
    Table,
    Id,
    UserId,
    CreatedOn,
    Data,
}

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230504_000010_create_summary"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Summary::Table)
                    .col(
                        ColumnDef::new(Summary::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Summary::UserId).integer().not_null())
                    .col(
                        ColumnDef::new(Summary::CreatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(Summary::Data).not_null().json())
                    .foreign_key(
                        ForeignKey::create()
                            .name("summary_to_user_foreign_key")
                            .from(Summary::Table, Summary::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Summary::Table).to_owned())
            .await?;
        Ok(())
    }
}
