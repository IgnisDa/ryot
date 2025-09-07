use sea_orm_migration::prelude::*;

use super::m20230404_create_user::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static USER_MEASUREMENT_PRIMARY_KEY: &str = "pk-user_measurement";

#[derive(Iden)]
pub enum UserMeasurement {
    Table,
    Timestamp,
    UserId,
    Name,
    Comment,
    Information,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(UserMeasurement::Table)
                    .col(
                        ColumnDef::new(UserMeasurement::Timestamp)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(ColumnDef::new(UserMeasurement::Name).text())
                    .col(ColumnDef::new(UserMeasurement::Comment).text())
                    .primary_key(
                        Index::create()
                            .name(USER_MEASUREMENT_PRIMARY_KEY)
                            .col(UserMeasurement::UserId)
                            .col(UserMeasurement::Timestamp),
                    )
                    .col(
                        ColumnDef::new(UserMeasurement::Information)
                            .json_binary()
                            .not_null(),
                    )
                    .col(ColumnDef::new(UserMeasurement::UserId).text().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-user_measurement-user_id")
                            .from(UserMeasurement::Table, UserMeasurement::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
