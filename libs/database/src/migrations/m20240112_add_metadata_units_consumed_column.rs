use sea_orm_migration::prelude::*;

use super::m20231017_create_user_to_entity::UserToEntity;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let table_name = "user_to_entity";
        let old_col_name = "num_times_interacted";
        if manager.has_column(table_name, old_col_name).await? {
            manager
                .alter_table(
                    TableAlterStatement::new()
                        .table(UserToEntity::Table)
                        .rename_column(
                            Alias::new(old_col_name),
                            UserToEntity::ExerciseNumTimesInteracted,
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
