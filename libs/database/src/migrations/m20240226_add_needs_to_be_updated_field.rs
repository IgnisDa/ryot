use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager
            .has_column("user_to_entity", "needs_to_be_updated")
            .await?
        {
            let db = manager.get_connection();
            db.execute_unprepared(
                "alter table user_to_entity add column needs_to_be_updated boolean",
            )
            .await?;
            db.execute_unprepared(
                "update user_to_entity set needs_to_be_updated = true where exercise_id is null",
            )
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
