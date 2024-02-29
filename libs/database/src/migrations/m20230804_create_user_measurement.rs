// FIXME: Rename this to `m20230621_create_user_measurement`

use sea_orm_migration::prelude::*;

use super::{m20230417_create_user::User, m20230819_create_workout::Workout};

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static USER_MEASUREMENT_PRIMARY_KEY: &str = "pk-user_measurement";
pub static USER_MEASUREMENT_TO_WORKOUT_FK: &str = "user_measurement-associated_with_workout-fk";

#[derive(Iden)]
pub enum UserMeasurement {
    Table,
    Timestamp,
    UserId,
    Name,
    Comment,
    Stats,
    AssociatedWithWorkout,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(UserMeasurement::Table)
                    .col(
                        ColumnDef::new(UserMeasurement::Timestamp)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(ColumnDef::new(UserMeasurement::UserId).integer().not_null())
                    .col(ColumnDef::new(UserMeasurement::Name).text())
                    .col(ColumnDef::new(UserMeasurement::Comment).text())
                    .primary_key(
                        Index::create()
                            .name(USER_MEASUREMENT_PRIMARY_KEY)
                            .col(UserMeasurement::UserId)
                            .col(UserMeasurement::Timestamp),
                    )
                    .col(
                        ColumnDef::new(UserMeasurement::Stats)
                            .json_binary()
                            .not_null(),
                    )
                    .col(ColumnDef::new(UserMeasurement::AssociatedWithWorkout).text())
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-user_measurement-user_id")
                            .from(UserMeasurement::Table, UserMeasurement::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                TableAlterStatement::new()
                    .table(UserMeasurement::Table)
                    .add_foreign_key(
                        TableForeignKey::new()
                            .name(USER_MEASUREMENT_TO_WORKOUT_FK)
                            .from_tbl(UserMeasurement::Table)
                            .from_col(UserMeasurement::AssociatedWithWorkout)
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
