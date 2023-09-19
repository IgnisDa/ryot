use sea_orm::{DatabaseBackend, Statement};
use sea_orm_migration::prelude::*;

use super::m20230901_create_partial_metadata::{
    PARTIAL_METADATA_FK_1, PARTIAL_METADATA_TO_METADATA_GROUP_FK_1,
    PARTIAL_METADATA_TO_METADATA_GROUP_FK_2,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

async fn change_fk_definition<'a>(
    table_name: &str,
    old_name: &str,
    new_name: &str,
    fk_from: &str,
    fk_to: &str,
    manager: &SchemaManager<'a>,
    action: &str,
) -> Result<(), DbErr> {
    let db = manager.get_connection();
    let stmt = Statement::from_sql_and_values(
                    manager.get_database_backend(),
                    "SELECT count(*) > 0 FROM information_schema.table_constraints WHERE constraint_name=$1 AND table_name=$2",
                    [old_name.into(), table_name.into()],
                );
    if let Some(row) = db.query_one(stmt).await? {
        let has_fk = row.try_get_by_index::<bool>(0).unwrap();
        if has_fk {
            db
                .execute_unprepared(&format!(
                    r#"
ALTER TABLE {table_name}
DROP CONSTRAINT "{old_name}",
ADD CONSTRAINT "{new_name}" FOREIGN KEY ({fk_from}) REFERENCES {fk_to}(id) ON UPDATE CASCADE ON DELETE {action};
"#
                ))
                .await?;
        }
    }
    Ok(())
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if matches!(manager.get_database_backend(), DatabaseBackend::Postgres) {
            change_fk_definition(
                "partial_metadata_to_metadata_group",
                "fk_partial-metadata-to-metadata-group-group_id-metadata-group_i",
                PARTIAL_METADATA_TO_METADATA_GROUP_FK_1,
                "metadata_group_id",
                "metadata_group",
                manager,
                "CASCADE",
            )
            .await?;
            change_fk_definition(
                "partial_metadata_to_metadata_group",
                "fk_partial-metadata-to-metadata-group_id-metadata-partial-metad",
                PARTIAL_METADATA_TO_METADATA_GROUP_FK_2,
                "partial_metadata_id",
                "partial_metadata",
                manager,
                "CASCADE",
            )
            .await?;
            change_fk_definition(
                "partial_metadata",
                PARTIAL_METADATA_FK_1,
                PARTIAL_METADATA_FK_1,
                "metadata_id",
                "metadata",
                manager,
                "SET NULL",
            )
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
