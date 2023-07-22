use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use sea_orm_migration::prelude::*;

use crate::{
    entities::{prelude::Seen as SeenModel, seen},
    migrator::m20230419_000003_create_seen::{Seen, SeenState},
};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230722_000019_add_state_field"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("seen", "state").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Seen::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(Seen::State)
                                .string_len(2)
                                .not_null()
                                .default(SeenState::InProgress),
                        )
                        .to_owned(),
                )
                .await?;
        }
        if manager.has_column("seen", "dropped").await? {
            let db = manager.get_connection();
            SeenModel::update_many()
                .filter(seen::Column::Progress.lt(100))
                .col_expr(seen::Column::State, Expr::val("IP").into())
                .exec(db)
                .await?;
            SeenModel::update_many()
                .filter(Expr::col(Alias::new("dropped")).eq(true))
                .col_expr(seen::Column::State, Expr::val("DR").into())
                .exec(db)
                .await?;
            manager
                .alter_table(
                    Table::alter()
                        .table(Seen::Table)
                        .drop_column(Alias::new("dropped"))
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
