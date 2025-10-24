use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared("DROP VIEW IF EXISTS enriched_user_to_exercise")
            .await?;
        db.execute_unprepared("DROP VIEW IF EXISTS enriched_user_to_metadata_group")
            .await?;
        db.execute_unprepared("DROP VIEW IF EXISTS enriched_user_to_person")
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
