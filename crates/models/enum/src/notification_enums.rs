use async_graphql::Enum;
use rust_decimal::Decimal;
use sea_orm::{DeriveActiveEnum, EnumIter, prelude::Date};
use sea_orm_migration::prelude::StringLen;
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
    NotificationFromReminderCollection {
        reminder_text: String,
    },
    IntegrationDisabledDueToTooManyErrors {
        provider_name: String,
    },
    NewWorkoutCreated {
        workout_id: String,
        workout_name: String,
    },
    MetadataStatusChanged {
        old_status: String,
        new_status: String,
        entity_title: String,
    },
    PersonMetadataAssociated {
        role: String,
        person_name: String,
        metadata_title: String,
    },
    MetadataEpisodeImagesChanged {
        episode_number: i32,
        entity_title: String,
        season_number: Option<i32>,
    },
    PersonMetadataGroupAssociated {
        role: String,
        person_name: String,
        metadata_group_title: String,
    },
    MetadataNumberOfSeasonsChanged {
        old_seasons: usize,
        new_seasons: usize,
        entity_title: String,
    },
    MetadataEpisodeReleased {
        entity_title: String,
        old_episode_count: usize,
        new_episode_count: usize,
        season_number: Option<i32>,
    },
    MetadataChaptersOrEpisodesChanged {
        old_count: Decimal,
        new_count: Decimal,
        entity_title: String,
        content_type: String,
    },
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
    OutdatedSeenEntries {
        seen_state: String,
        days_threshold: i64,
        entity_title: String,
        entity_lot: EntityLot,
        last_updated_on: Date,
    },
    MetadataReleaseDateChanged {
        old_date: String,
        new_date: String,
        entity_title: String,
        season_number: Option<i32>,
        episode_number: Option<i32>,
    },
    MetadataEpisodeNameChanged {
        old_name: String,
        new_name: String,
        episode_number: i32,
        entity_title: String,
        season_number: Option<i32>,
    },
    MetadataMovedFromCompletedToWatchlistCollection {
        entity_id: String,
        entity_title: String,
        entity_lot: EntityLot,
    },
}
