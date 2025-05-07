use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        if !manager.has_column("integration", "extra_settings").await? {
            db.execute_unprepared(
                r#"
                ALTER TABLE integration
                ADD COLUMN extra_settings jsonb;

                UPDATE integration
                SET extra_settings = '{"disable_on_continuous_errors": true}'
                WHERE extra_settings IS NULL;

                ALTER TABLE integration
                ALTER COLUMN extra_settings SET NOT NULL;
                "#,
            )
            .await?;
        }

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
