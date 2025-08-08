use async_graphql::Enum;
use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};
use strum::{Display, EnumDiscriminants};

use crate::EntityLot;

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

#[derive(Debug, Clone, Display, PartialEq, Serialize, Deserialize, EnumDiscriminants)]
#[strum_discriminants(
    derive(Enum, EnumIter, Serialize, Deserialize, DeriveActiveEnum),
    sea_orm(
        rs_type = "String",
        rename_all = "snake_case",
        db_type = "String(StringLen::None)"
    )
)]
pub enum UserNotificationContent {
    ReviewPosted {
        entity_id: String,
        entity_title: String,
        entity_lot: EntityLot,
        triggered_by_username: String,
    },
    MetadataPublished {
        entity_id: String,
        entity_title: String,
        entity_lot: EntityLot,
        podcast_extra: Option<i32>,
        show_extra: Option<(i32, i32)>,
    },
    NewWorkoutCreated {
        workout_id: String,
        workout_name: String,
    },
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
    IntegrationDisabledDueToTooManyErrors,
}
