use sea_orm_migration::prelude::*;

use super::{
    m20230419_create_seen::{SEEN_USER_DATE_INDEX, Seen},
    m20230507_create_workout::{WORKOUT_USER_DATE_INDEX, Workout},
    m20230508_create_review::{REVIEW_USER_DATE_INDEX, Review},
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_index(
                Index::create()
                    .name(SEEN_USER_DATE_INDEX)
                    .table(Seen::Table)
                    .col(Seen::UserId)
                    .col(Seen::FinishedOn)
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name(WORKOUT_USER_DATE_INDEX)
                    .table(Workout::Table)
                    .col(Workout::UserId)
                    .col(Workout::EndTime)
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name(REVIEW_USER_DATE_INDEX)
                    .table(Review::Table)
                    .col(Review::UserId)
                    .col(Review::PostedOn)
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        manager
            .drop_table(
                Table::drop()
                    .table(Alias::new("daily_user_activity"))
                    .if_exists()
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
