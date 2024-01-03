use async_graphql::{Enum, SimpleObject};
use kinded::Kinded;
use sea_orm::{prelude::DateTimeUtc, FromJsonQueryResult};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use strum::EnumString;

use crate::models::fitness::UserUnitSystem;

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserNotificationsPreferences {
    pub status_changed: bool,
    pub episode_released: bool,
    pub release_date_changed: bool,
    pub episode_images_changed: bool,
    // Show
    pub episode_name_changed: bool,
    pub number_of_seasons_changed: bool,
    // Anime and Manga
    pub number_of_chapters_or_episodes_changed: bool,
    pub new_review_posted: bool,
}

impl Default for UserNotificationsPreferences {
    fn default() -> Self {
        Self {
            status_changed: true,
            episode_released: true,
            episode_name_changed: true,
            episode_images_changed: true,
            release_date_changed: true,
            number_of_seasons_changed: true,
            number_of_chapters_or_episodes_changed: true,
            new_review_posted: true,
        }
    }
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserMediaFeaturesEnabledPreferences {
    pub enabled: bool,
    pub anime: bool,
    pub audio_book: bool,
    pub book: bool,
    pub manga: bool,
    pub movie: bool,
    pub podcast: bool,
    pub show: bool,
    pub video_game: bool,
    pub visual_novel: bool,
}

impl Default for UserMediaFeaturesEnabledPreferences {
    fn default() -> Self {
        Self {
            enabled: true,
            anime: true,
            audio_book: true,
            book: true,
            manga: true,
            movie: true,
            podcast: true,
            show: true,
            video_game: true,
            visual_novel: true,
        }
    }
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserFitnessFeaturesEnabledPreferences {
    pub enabled: bool,
    pub measurements: bool,
    pub workouts: bool,
}

impl Default for UserFitnessFeaturesEnabledPreferences {
    fn default() -> Self {
        Self {
            enabled: true,
            measurements: true,
            workouts: true,
        }
    }
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserExercisePreferences {
    pub save_history: usize,
    pub default_timer: Option<usize>,
    pub unit_system: UserUnitSystem,
}

impl Default for UserExercisePreferences {
    fn default() -> Self {
        Self {
            save_history: 15,
            default_timer: Some(60),
            unit_system: UserUnitSystem::Metric,
        }
    }
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserMeasurementsInBuiltPreferences {
    pub weight: bool,
    pub body_mass_index: bool,
    pub total_body_water: bool,
    pub muscle: bool,
    pub body_fat: bool,
    pub waist_to_height_ratio: bool,
    pub waist_to_hip_ratio: bool,
    pub basal_metabolic_rate: bool,
    pub total_daily_energy_expenditure: bool,
    pub calories: bool,
    pub lean_body_mass: bool,
    pub bone_mass: bool,
    pub visceral_fat: bool,
    pub waist_circumference: bool,
    pub hip_circumference: bool,
    pub chest_circumference: bool,
    pub thigh_circumference: bool,
    pub biceps_circumference: bool,
    pub neck_circumference: bool,
    pub body_fat_caliper: bool,
    pub chest_skinfold: bool,
    pub abdominal_skinfold: bool,
    pub thigh_skinfold: bool,
}

impl Default for UserMeasurementsInBuiltPreferences {
    fn default() -> Self {
        Self {
            weight: true,
            body_mass_index: true,
            total_body_water: true,
            muscle: true,
            body_fat: true,
            waist_to_height_ratio: true,
            waist_to_hip_ratio: true,
            basal_metabolic_rate: true,
            total_daily_energy_expenditure: true,
            calories: false,
            lean_body_mass: false,
            bone_mass: false,
            visceral_fat: false,
            waist_circumference: false,
            hip_circumference: false,
            chest_circumference: false,
            thigh_circumference: false,
            biceps_circumference: false,
            neck_circumference: false,
            body_fat_caliper: false,
            chest_skinfold: false,
            abdominal_skinfold: false,
            thigh_skinfold: false,
        }
    }
}

#[derive(
    Debug, Serialize, Deserialize, Enum, Clone, Eq, PartialEq, FromJsonQueryResult, Copy, Default,
)]
#[serde(rename_all = "UPPERCASE")]
pub enum UserCustomMeasurementDataType {
    #[default]
    Decimal,
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult, Default,
)]
#[serde(rename_all = "camelCase")]
pub struct UserCustomMeasurement {
    pub name: String,
    pub data_type: UserCustomMeasurementDataType,
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserMeasurementsPreferences {
    pub custom: Vec<UserCustomMeasurement>,
    pub inbuilt: UserMeasurementsInBuiltPreferences,
}

impl Default for UserMeasurementsPreferences {
    fn default() -> Self {
        Self {
            custom: vec![UserCustomMeasurement {
                name: "sugar_level".to_owned(),
                data_type: UserCustomMeasurementDataType::Decimal,
            }],
            inbuilt: UserMeasurementsInBuiltPreferences::default(),
        }
    }
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, Default, FromJsonQueryResult,
)]
pub struct UserFeaturesEnabledPreferences {
    pub media: UserMediaFeaturesEnabledPreferences,
    pub fitness: UserFitnessFeaturesEnabledPreferences,
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, Default, FromJsonQueryResult,
)]
pub struct UserFitnessPreferences {
    pub exercises: UserExercisePreferences,
    pub measurements: UserMeasurementsPreferences,
}

#[derive(
    Debug,
    Serialize,
    Default,
    Deserialize,
    Enum,
    Clone,
    Eq,
    PartialEq,
    FromJsonQueryResult,
    Copy,
    EnumString,
)]
#[strum(ascii_case_insensitive, serialize_all = "SCREAMING_SNAKE_CASE")]
pub enum UserReviewScale {
    OutOfFive,
    #[default]
    OutOfHundred,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, Eq, PartialEq, FromJsonQueryResult, Copy)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DashboardElementLot {
    Upcoming,
    InProgress,
    Summary,
    Actions,
}

#[skip_serializing_none]
#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
#[serde(rename_all = "camelCase")]
pub struct UserGeneralDashboardElement {
    pub section: DashboardElementLot,
    pub hidden: bool,
    pub num_elements: Option<i32>,
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserGeneralPreferences {
    pub review_scale: UserReviewScale,
    pub display_nsfw: bool,
    pub disable_yank_integrations: bool,
    pub dashboard: Vec<UserGeneralDashboardElement>,
}

impl Default for UserGeneralPreferences {
    fn default() -> Self {
        Self {
            review_scale: UserReviewScale::default(),
            display_nsfw: true,
            disable_yank_integrations: false,
            dashboard: vec![
                UserGeneralDashboardElement {
                    section: DashboardElementLot::Upcoming,
                    hidden: false,
                    num_elements: Some(8),
                },
                UserGeneralDashboardElement {
                    section: DashboardElementLot::InProgress,
                    hidden: false,
                    num_elements: Some(8),
                },
                UserGeneralDashboardElement {
                    section: DashboardElementLot::Summary,
                    hidden: false,
                    num_elements: None,
                },
                UserGeneralDashboardElement {
                    section: DashboardElementLot::Actions,
                    hidden: false,
                    num_elements: None,
                },
            ],
        }
    }
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, Default, FromJsonQueryResult,
)]
pub struct UserPreferences {
    pub features_enabled: UserFeaturesEnabledPreferences,
    pub notifications: UserNotificationsPreferences,
    pub fitness: UserFitnessPreferences,
    pub general: UserGeneralPreferences,
}

#[derive(Kinded, Debug, Serialize, Deserialize, Clone, Eq, PartialEq, FromJsonQueryResult)]
#[serde(tag = "t", content = "d")]
#[kinded(derive(Enum, Serialize, Deserialize, Clone, Debug, Copy, PartialEq, Eq))]
pub enum UserYankIntegrationSetting {
    Audiobookshelf { base_url: String, token: String },
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, FromJsonQueryResult)]
pub struct UserYankIntegration {
    pub id: usize,
    pub settings: UserYankIntegrationSetting,
    /// the date and time it was added on
    pub timestamp: DateTimeUtc,
}

#[derive(Kinded, Debug, Serialize, Deserialize, Clone, Eq, PartialEq, FromJsonQueryResult)]
#[serde(tag = "t", content = "d")]
#[kinded(derive(Enum, Serialize, Deserialize, Clone, Debug, Copy, PartialEq, Eq))]
pub enum UserSinkIntegrationSetting {
    Jellyfin { slug: String },
    Plex { slug: String, user: Option<String> },
    Kodi { slug: String },
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, FromJsonQueryResult)]
pub struct UserSinkIntegration {
    pub id: usize,
    pub settings: UserSinkIntegrationSetting,
    /// the date and time it was added on
    pub timestamp: DateTimeUtc,
}

#[derive(Kinded, Debug, Serialize, Deserialize, Clone, Eq, PartialEq, FromJsonQueryResult)]
#[serde(tag = "t", content = "d")]
#[kinded(derive(Enum, Serialize, Deserialize, Clone, Debug, Copy, PartialEq, Eq))]
pub enum UserNotificationSetting {
    Apprise {
        url: String,
        key: String,
    },
    Discord {
        url: String,
    },
    Gotify {
        url: String,
        token: String,
        priority: Option<i32>,
    },
    Ntfy {
        url: Option<String>,
        topic: String,
        priority: Option<i32>,
        auth_header: Option<String>,
    },
    PushBullet {
        api_token: String,
    },
    PushOver {
        key: String,
        app_key: Option<String>,
    },
    PushSafer {
        key: String,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, FromJsonQueryResult)]
pub struct UserNotification {
    pub id: usize,
    pub settings: UserNotificationSetting,
    /// the date and time it was added on
    pub timestamp: DateTimeUtc,
}
