use sea_orm::EntityTrait;
use sea_orm_migration::prelude::*;

use super::m20230622_create_exercise::Exercise;
use crate::entities::{exercise, prelude::Exercise as ExerciseModel};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("exercise", "source").await? {
            let db = manager.get_connection();
            manager
                .alter_table(
                    Table::alter()
                        .table(Exercise::Table)
                        .add_column(ColumnDef::new(Exercise::Source).string_len(2))
                        .to_owned(),
                )
                .await?;
            ExerciseModel::update_many()
                .col_expr(exercise::Column::Source, Expr::value("GH"))
                .exec(db)
                .await?;
            manager
                .alter_table(
                    Table::alter()
                        .table(Exercise::Table)
                        .modify_column(ColumnDef::new(Exercise::Source).not_null())
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
