use sea_orm_migration::prelude::*;

use super::m20230419_000003_create_seen::Seen;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230612_000009_add_dropped_field"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Seen::Table)
                    .add_column_if_not_exists(
                        ColumnDef::new(Seen::Dropped).boolean().default(false),
                    )
                    .to_owned(),
            )
            .await
            .ok();
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
