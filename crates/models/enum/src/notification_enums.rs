use async_graphql::Enum;
use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};
use strum::Display;

#[derive(
    Eq,
    Enum,
    Copy,
    Clone,
    Debug,
    Display,
    EnumIter,
    PartialEq,
    Serialize,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
#[serde(rename_all = "snake_case")]
pub enum NotificationPlatformLot {
    Ntfy,
    Gotify,
    Apprise,
    Discord,
    PushOver,
    Telegram,
    PushSafer,
    PushBullet,
}

#[derive(
    Eq,
    Enum,
    Copy,
    Clone,
    Debug,
    Display,
    EnumIter,
    PartialEq,
    Serialize,
    Deserialize,
    DeriveActiveEnum,
)]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
pub enum UserNotificationContent {
    ReviewPosted,
    MetadataPublished,
    NewWorkoutCreated,
    OutdatedSeenEntries,
    MetadataStatusChanged,
    MetadataEpisodeReleased,
    PersonMetadataAssociated,
    MetadataReleaseDateChanged,
    MetadataEpisodeNameChanged,
    MetadataEpisodeImagesChanged,
    PersonMetadataGroupAssociated,
    MetadataNumberOfSeasonsChanged,
    MetadataChaptersOrEpisodesChanged,
    NotificationFromReminderCollection,
    EntityRemovedFromMonitoringCollection,
    IntegrationDisabledDueToTooManyErrors,
}
