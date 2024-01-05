use sea_orm_migration::prelude::*;

use super::m20230819_create_workout::Workout;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("workout", "repeated_from").await? {
            manager
                .alter_table(
                    TableAlterStatement::new()
                        .table(Workout::Table)
                        .add_column(ColumnDef::new(Workout::RepeatedFrom).string())
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
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
