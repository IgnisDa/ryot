use sea_orm_migration::prelude::*;

use super::{m20230417_create_user::User, m20230622_create_exercise::Exercise};

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static USER_TO_EXERCISE_PRIMARY_KEY: &str = "pk-user_to_exercise";

#[derive(Iden)]
pub enum UserToExercise {
    Table,
    UserId,
    ExerciseId,
    LastUpdatedOn,
    NumTimesPerformed,
    ExtraInformation,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(UserToExercise::Table)
                    .col(ColumnDef::new(UserToExercise::UserId).integer().not_null())
                    .col(
                        ColumnDef::new(UserToExercise::ExerciseId)
                            .integer()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .name(USER_TO_EXERCISE_PRIMARY_KEY)
                            .col(UserToExercise::UserId)
                            .col(UserToExercise::ExerciseId),
                    )
                    .col(
                        ColumnDef::new(UserToExercise::NumTimesPerformed)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(UserToExercise::LastUpdatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(UserToExercise::ExtraInformation)
                            .json()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-user_to_exercise-user_id")
                            .from(UserToExercise::Table, UserToExercise::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-user_to_exercise-exercise_id")
                            .from(UserToExercise::Table, UserToExercise::ExerciseId)
                            .to(Exercise::Table, Exercise::Id)
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
