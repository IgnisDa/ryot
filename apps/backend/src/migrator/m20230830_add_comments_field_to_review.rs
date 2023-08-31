use sea_orm::EntityTrait;
use sea_orm_migration::prelude::*;

use super::Review;
use crate::entities::{prelude::Review as ReviewModel, review};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("review", "comments").await? {
            let db = manager.get_connection();
            manager
                .alter_table(
                    Table::alter()
                        .table(Review::Table)
                        .add_column(ColumnDef::new(Review::Comments).json())
                        .to_owned(),
                )
                .await?;
            ReviewModel::update_many()
                .col_expr(review::Column::Comments, Expr::value(serde_json::json!([])))
                .exec(db)
                .await?;
            manager
                .alter_table(
                    Table::alter()
                        .table(Review::Table)
                        .modify_column(ColumnDef::new(Review::Comments).not_null())
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
