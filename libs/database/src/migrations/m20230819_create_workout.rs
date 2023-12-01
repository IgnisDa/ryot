use async_graphql::Enum;
use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};
use strum::EnumString;

use super::m20230417_create_user::User;

#[derive(
    Debug,
    Serialize,
    Deserialize,
    Enum,
    Clone,
    Eq,
    PartialEq,
    Copy,
    EnumString,
    Default,
    DeriveActiveEnum,
    EnumIter,
)]
#[strum(ascii_case_insensitive, serialize_all = "SCREAMING_SNAKE_CASE")]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum UserUnitSystem {
    #[sea_orm(string_value = "M")]
    #[default]
    Metric,
    #[sea_orm(string_value = "I")]
    Imperial,
}

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum Workout {
    Table,
    Id,
    UserId,
    Name,
    Comment,
    StartTime,
    EndTime,
    /// General information like total weights lifted, number of records etc.
    Summary,
    /// Actual exercises performed, supersets, etc.
    Information,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Workout::Table)
                    .col(
                        ColumnDef::new(Workout::Id)
                            .primary_key()
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Workout::StartTime)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Workout::EndTime)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Workout::UserId).integer().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("workout_to_user_foreign_key")
                            .from(Workout::Table, Workout::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(Workout::Summary).json().not_null())
                    .col(ColumnDef::new(Workout::Information).json().not_null())
                    .col(ColumnDef::new(Workout::Name).string().not_null())
                    .col(ColumnDef::new(Workout::Comment).string().null())
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
