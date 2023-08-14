use async_graphql::Enum;
use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230622_create_exercise"
    }
}

#[derive(
    Clone, Debug, Deserialize, Serialize, DeriveActiveEnum, Eq, PartialEq, Enum, Copy, EnumIter,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum ExerciseLot {
    #[sea_orm(string_value = "D")]
    Duration,
    #[sea_orm(string_value = "DD")]
    DistanceAndDuration,
    #[sea_orm(string_value = "RW")]
    RepsAndWeight,
}

#[derive(Iden)]
pub enum Exercise {
    Table,
    Id,
    Name,
    Lot,
    Identifier,
    Attributes,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Exercise::Table)
                    .col(
                        ColumnDef::new(Exercise::Id)
                            .primary_key()
                            .auto_increment()
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Exercise::Name)
                            .string()
                            .unique_key()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Exercise::Lot).string_len(2).not_null())
                    .col(
                        ColumnDef::new(Exercise::Identifier)
                            .string()
                            .unique_key()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Exercise::Attributes).json().not_null())
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
