use sea_orm::{DatabaseBackend, Statement};
use sea_orm_migration::prelude::*;

use super::m20230901_create_partial_metadata::{
    PARTIAL_METADATA_TO_METADATA_GROUP_FK_1, PARTIAL_METADATA_TO_METADATA_GROUP_FK_2,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

async fn change_fk_definition<'a>(
    old_name: &str,
    new_name: &str,
    manager: &SchemaManager<'a>,
    action: &str,
) -> Result<(), DbErr> {
    let db = manager.get_connection();
    let stmt = Statement::from_sql_and_values(
                    manager.get_database_backend(),
                    "SELECT count(*) > 0 FROM information_schema.table_constraints WHERE constraint_name=$1 AND table_name=$2",
                    [old_name.into(), "partial_metadata_to_metadata_group".into()],
                );
    if let Some(row) = db.query_one(stmt).await? {
        let has_fk = row.try_get_by_index::<bool>(0).unwrap();
        if has_fk {
            db
                .execute_unprepared(&format!(
                    r#"
ALTER TABLE partial_metadata_to_metadata_group
DROP CONSTRAINT "{old_name}",
ADD CONSTRAINT "{new_name}" FOREIGN KEY (metadata_group_id) REFERENCES metadata_group(id) ON UPDATE CASCADE ON DELETE {action};
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
                "fk_partial-metadata-to-metadata-group-group_id-metadata-group_i",
                PARTIAL_METADATA_TO_METADATA_GROUP_FK_1,
                manager,
                "CASCADE",
            )
            .await?;
            change_fk_definition(
                "fk_partial-metadata-to-metadata-group_id-metadata-partial-metad",
                PARTIAL_METADATA_TO_METADATA_GROUP_FK_2,
                manager,
                "CASCADE",
            )
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
