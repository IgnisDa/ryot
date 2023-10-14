use async_graphql::Enum;
use schematic::ConfigEnum;
use sea_orm::{DeriveActiveEnum, EnumIter, FromJsonQueryResult};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};
use strum::Display;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(
    Debug,
    Clone,
    Serialize,
    Enum,
    Copy,
    Deserialize,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    Display,
    EnumIter,
    PartialOrd,
    Ord,
)]
#[serde(rename_all = "snake_case")]
pub enum ExerciseMuscle {
    Abdominals,
    Abductors,
    Adductors,
    Biceps,
    Calves,
    Chest,
    Forearms,
    Glutes,
    Hamstrings,
    Lats,
    #[strum(serialize = "lower_back")]
    #[serde(alias = "lower back")]
    LowerBack,
    #[strum(serialize = "middle_back")]
    #[serde(alias = "middle back")]
    MiddleBack,
    Neck,
    Quadriceps,
    Shoulders,
    Traps,
    Triceps,
}

#[derive(
    Debug, Clone, Serialize, Enum, Copy, Deserialize, DeriveActiveEnum, EnumIter, Eq, PartialEq,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
#[serde(rename_all = "snake_case")]
pub enum ExerciseForce {
    #[sea_orm(string_value = "PUL")]
    Pull,
    #[sea_orm(string_value = "PUS")]
    Push,
    #[sea_orm(string_value = "S")]
    Static,
}

#[derive(
    Debug, Clone, Serialize, Enum, Copy, Deserialize, DeriveActiveEnum, EnumIter, Eq, PartialEq,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
#[serde(rename_all = "snake_case")]
pub enum ExerciseLevel {
    #[sea_orm(string_value = "B")]
    Beginner,
    #[sea_orm(string_value = "E")]
    Expert,
    #[sea_orm(string_value = "I")]
    Intermediate,
}

#[derive(
    Debug, Clone, Serialize, Enum, Copy, Deserialize, DeriveActiveEnum, EnumIter, Eq, PartialEq,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
#[serde(rename_all = "snake_case")]
pub enum ExerciseMechanic {
    #[sea_orm(string_value = "C")]
    Compound,
    #[sea_orm(string_value = "I")]
    Isolation,
}

#[derive(
    Debug, Clone, Serialize, Enum, Copy, Deserialize, DeriveActiveEnum, EnumIter, Eq, PartialEq,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
#[serde(rename_all = "snake_case")]
pub enum ExerciseEquipment {
    #[sea_orm(string_value = "BAN")]
    Bands,
    #[sea_orm(string_value = "BAR")]
    Barbell,
    #[sea_orm(string_value = "BO")]
    BodyOnly,
    #[sea_orm(string_value = "D")]
    Dumbbell,
    #[sea_orm(string_value = "C")]
    Cable,
    #[sea_orm(string_value = "EX")]
    #[serde(alias = "exercise ball")]
    ExerciseBall,
    #[sea_orm(string_value = "EZ")]
    #[serde(alias = "e-z curl bar")]
    EZCurlBar,
    #[sea_orm(string_value = "F")]
    #[serde(alias = "foam roll")]
    FoamRoll,
    #[sea_orm(string_value = "K")]
    #[serde(alias = "body only")]
    Kettlebells,
    #[sea_orm(string_value = "MA")]
    Machine,
    #[sea_orm(string_value = "ME")]
    #[serde(alias = "medicine ball")]
    MedicineBall,
    #[sea_orm(string_value = "O")]
    Other,
}

#[derive(
    Clone,
    Debug,
    Deserialize,
    Serialize,
    DeriveActiveEnum,
    Eq,
    PartialEq,
    Enum,
    Copy,
    EnumIter,
    ConfigEnum,
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

#[derive(
    Clone, Debug, Deserialize, Serialize, DeriveActiveEnum, Eq, PartialEq, Enum, Copy, EnumIter,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum ExerciseSource {
    #[sea_orm(string_value = "GH")]
    Github,
    #[sea_orm(string_value = "CU")]
    Custom,
}

#[derive(Iden)]
pub enum Exercise {
    Table,
    Id,
    Name,
    Lot,
    Force,
    Level,
    Mechanic,
    Equipment,
    Muscles,
    Identifier,
    Attributes,
    Source,
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
                    .col(ColumnDef::new(Exercise::Muscles).json().not_null())
                    .col(ColumnDef::new(Exercise::Lot).string_len(2).not_null())
                    .col(ColumnDef::new(Exercise::Level).string_len(1).not_null())
                    .col(ColumnDef::new(Exercise::Force).string_len(3).null())
                    .col(ColumnDef::new(Exercise::Mechanic).string_len(1).null())
                    .col(ColumnDef::new(Exercise::Equipment).string_len(3).null())
                    .col(ColumnDef::new(Exercise::Identifier).string().unique_key())
                    .col(ColumnDef::new(Exercise::Attributes).json().not_null())
                    .col(ColumnDef::new(Exercise::Source).string_len(2).not_null())
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
