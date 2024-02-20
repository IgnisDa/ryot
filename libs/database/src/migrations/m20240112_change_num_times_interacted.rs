use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        let table_name = "user_to_entity";
        let old_col_name = "num_times_interacted";
        let new_col_name = "exercise_num_times_interacted";
        if manager.has_column(table_name, old_col_name).await? {
            db.execute_unprepared(&format!(
                r"
ALTER TABLE {table_name} RENAME COLUMN {old_col_name} TO {new_col_name};
ALTER TABLE {table_name} ALTER COLUMN {new_col_name} DROP NOT NULL;
UPDATE {table_name} SET {new_col_name} = NULL WHERE metadata_id IS NOT NULL;
                ",
            ))
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
