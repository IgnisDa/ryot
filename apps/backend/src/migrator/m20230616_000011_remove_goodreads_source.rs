use crate::entities::{metadata, prelude::Metadata};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230616_000011_remove_goodreads_source"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        Metadata::update_many()
            .col_expr(metadata::Column::Source, Expr::value("CU"))
            .filter(metadata::Column::Source.eq("GO"))
            .exec(db)
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
