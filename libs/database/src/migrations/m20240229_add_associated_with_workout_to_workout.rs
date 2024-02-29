use sea_orm_migration::prelude::*;

use super::{
    m20230804_create_user_measurement::{UserMeasurement, USER_MEASUREMENT_TO_WORKOUT_FK},
    m20230819_create_workout::Workout,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager
            .has_column("user_measurement", "associated_with_workout")
            .await?
        {
            manager
                .alter_table(
                    TableAlterStatement::new()
                        .table(UserMeasurement::Table)
                        .add_column(ColumnDef::new(UserMeasurement::AssociatedWithWorkout).text())
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
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
