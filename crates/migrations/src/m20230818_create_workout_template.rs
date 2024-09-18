// FIXME: Rename this to m20230506_create_workout_template in the next major release
use enums::Visibility;
use sea_orm_migration::prelude::*;

use super::m20230417_create_user::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum WorkoutTemplate {
    Table,
    Id,
    UserId,
    CreatedOn,
    Name,
    Summary,
    Visibility,
    Information,
    DefaultRestTimer,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(WorkoutTemplate::Table)
                    .col(
                        ColumnDef::new(WorkoutTemplate::Id)
                            .primary_key()
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(WorkoutTemplate::Visibility)
                            .text()
                            .not_null()
                            .default(Visibility::Private),
                    )
                    .col(
                        ColumnDef::new(WorkoutTemplate::Summary)
                            .json_binary()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(WorkoutTemplate::Information)
                            .json_binary()
                            .not_null(),
                    )
                    .col(ColumnDef::new(WorkoutTemplate::Name).text().not_null())
                    .col(ColumnDef::new(WorkoutTemplate::UserId).text().not_null())
                    .col(
                        ColumnDef::new(WorkoutTemplate::CreatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(WorkoutTemplate::DefaultRestTimer).integer())
                    .foreign_key(
                        ForeignKey::create()
                            .name("workout_template_to_user_foreign_key")
                            .from(WorkoutTemplate::Table, WorkoutTemplate::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
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
