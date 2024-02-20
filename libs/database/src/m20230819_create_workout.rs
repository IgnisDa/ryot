use sea_orm_migration::prelude::*;

use super::m20230417_create_user::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum Workout {
    Table,
    Id,
    UserId,
    Name,
    Comment,
    StartTime,
    EndTime,
    /// General information like total weights lifted, number of records etc.
    Summary,
    /// Actual exercises performed, supersets, etc.
    Information,
    /// The workout this one was repeated from
    RepeatedFrom,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Workout::Table)
                    .col(
                        ColumnDef::new(Workout::Id)
                            .primary_key()
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Workout::StartTime)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Workout::EndTime)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Workout::UserId).integer().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("workout_to_user_foreign_key")
                            .from(Workout::Table, Workout::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(Workout::Summary).json_binary().not_null())
                    .col(
                        ColumnDef::new(Workout::Information)
                            .json_binary()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Workout::Name).string().not_null())
                    .col(ColumnDef::new(Workout::Comment).string())
                    .col(ColumnDef::new(Workout::RepeatedFrom).string())
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                TableAlterStatement::new()
                    .table(Workout::Table)
                    .add_foreign_key(
                        TableForeignKey::new()
                            .name("workout_repeated_from_fk")
                            .from_tbl(Workout::Table)
                            .from_col(Workout::RepeatedFrom)
                            .to_tbl(Workout::Table)
                            .to_col(Workout::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
