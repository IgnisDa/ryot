use sea_orm_migration::prelude::*;

use super::m20230505_create_exercise::{EXERCISE_NAME_SEARCH_VECTOR_INDEX, Exercise};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("exercise", "name_search_vector").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Exercise::Table)
                        .add_column(ColumnDef::new(Exercise::NameSearchVector).extra(
                            "tsvector GENERATED ALWAYS AS (to_tsvector('english', name)) STORED",
                        ))
                        .to_owned(),
                )
                .await?;
        }

        if !manager
            .has_index("exercise", EXERCISE_NAME_SEARCH_VECTOR_INDEX)
            .await?
        {
            let db = manager.get_connection();
            db.execute_unprepared(&format!(
                r#"CREATE INDEX "{}" ON "exercise" USING gin (name_search_vector);"#,
                EXERCISE_NAME_SEARCH_VECTOR_INDEX
            ))
            .await?;
        }

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
