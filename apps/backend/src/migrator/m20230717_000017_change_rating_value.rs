use sea_orm::EntityTrait;
use sea_orm_migration::prelude::*;

use crate::entities::{prelude::Review as TempReview, review};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230717_000017_change_rating_value"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        TempReview::update_many()
            .col_expr(
                review::Column::Rating,
                Expr::col(review::Column::Rating).mul(Expr::value(20)),
            )
            .exec(db)
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
