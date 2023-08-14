use sea_orm::EntityTrait;
use sea_orm_migration::prelude::*;

use super::m20230622_create_exercise::Exercise;
use crate::entities::prelude::Exercise as ExerciseModel;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230814_add_lot_field_to_exercise"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("exercise", "lot").await? {
            let db = manager.get_connection();
            ExerciseModel::delete_many().exec(db).await?;
            manager
                .alter_table(
                    Table::alter()
                        .table(Exercise::Table)
                        .add_column(ColumnDef::new(Exercise::Lot).string_len(2).not_null())
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
