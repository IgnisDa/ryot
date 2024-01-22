use sea_orm::Statement;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        let backend = manager.get_database_backend();
        let schema = db
            .query_one(Statement::from_string(
                backend,
                r#"SELECT current_schema() AS schema_name"#,
            ))
            .await?
            .unwrap()
            .try_get_by_index::<String>(0)
            .unwrap();
        db.execute_unprepared(
               &format!(r#"UPDATE {}.user SET preferences = replace(preferences::text, ', {{"hidden": true, "section": "ACTIONS"}}', '')::jsonb;"#,schema)
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
