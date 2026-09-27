use sea_orm_migration::prelude::*;

pub async fn create_trigram_index_if_required(
    manager: &SchemaManager<'_>,
    table_name: &str,
    column_name: &str,
    index_name: &str,
) -> Result<(), DbErr> {
    if !manager.has_index(table_name, index_name).await? {
        let db = manager.get_connection();
        db.execute_unprepared(&format!(
            r#"CREATE INDEX "{index_name}" ON "{table_name}" USING gin ("{column_name}" gin_trgm_ops);"#
        ))
        .await?;
    }
    Ok(())
}
