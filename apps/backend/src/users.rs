use async_graphql::{Enum, SimpleObject};
use kinded::Kinded;
use sea_orm::{prelude::DateTimeUtc, FromJsonQueryResult};
use serde::{Deserialize, Serialize};
use strum::EnumString;

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserNotificationsPreferences {
    pub status_changed: bool,
    pub episode_released: bool,
    pub release_date_changed: bool,
    pub number_of_seasons_changed: bool,
}

impl Default for UserNotificationsPreferences {
    fn default() -> Self {
        Self {
            status_changed: true,
            episode_released: true,
            release_date_changed: true,
            number_of_seasons_changed: true,
        }
    }
}

#[derive(
    Debug,
    Serialize,
    Deserialize,
    Enum,
    Clone,
    Eq,
    PartialEq,
    FromJsonQueryResult,
    Copy,
    EnumString,
    Default,
)]
#[strum(ascii_case_insensitive)]
pub enum UserWeightUnit {
    #[default]
    Kilogram,
    Pound,
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserExercisePreferences {
    #[serde(default)]
    pub save_history: usize,
    #[serde(default)]
    pub weight_unit: UserWeightUnit,
}

impl Default for UserExercisePreferences {
    fn default() -> Self {
        Self {
            save_history: 15,
            weight_unit: UserWeightUnit::Kilogram,
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

#[derive(Debug, Serialize, Deserialize, Enum, Clone, Eq, PartialEq, FromJsonQueryResult, Copy)]
#[serde(rename_all = "UPPERCASE")]
pub enum UserCustomMeasurementDataType {
    Decimal,
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
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
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserFeaturesEnabledPreferences {
    #[serde(default)]
    pub media: bool,
    #[serde(default)]
    pub anime: bool,
    #[serde(default)]
    pub audio_book: bool,
    #[serde(default)]
    pub book: bool,
    #[serde(default)]
    pub manga: bool,
    #[serde(default)]
    pub movie: bool,
    #[serde(default)]
    pub podcast: bool,
    #[serde(default)]
    pub show: bool,
    #[serde(default)]
    pub video_game: bool,
    #[serde(default)]
    pub fitness: bool,
}

impl Default for UserFeaturesEnabledPreferences {
    fn default() -> Self {
        Self {
            media: true,
            anime: true,
            audio_book: true,
            book: true,
            manga: true,
            movie: true,
            podcast: true,
            show: true,
            video_game: true,
            fitness: true,
        }
    }
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, Default, FromJsonQueryResult,
)]
pub struct UserFitnessPreferences {
    #[serde(default)]
    pub exercises: UserExercisePreferences,
    #[serde(default)]
    pub measurements: UserMeasurementsPreferences,
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, Default, FromJsonQueryResult,
)]
pub struct UserPreferences {
    #[serde(default)]
    pub features_enabled: UserFeaturesEnabledPreferences,
    #[serde(default)]
    pub notifications: UserNotificationsPreferences,
    #[serde(default)]
    pub fitness: UserFitnessPreferences,
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

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, FromJsonQueryResult)]
pub struct UserYankIntegrations(pub Vec<UserYankIntegration>);

#[derive(Kinded, Debug, Serialize, Deserialize, Clone, Eq, PartialEq, FromJsonQueryResult)]
#[serde(tag = "t", content = "d")]
#[kinded(derive(Enum, Serialize, Deserialize, Clone, Debug, Copy, PartialEq, Eq))]
pub enum UserSinkIntegrationSetting {
    Jellyfin { slug: String },
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, FromJsonQueryResult)]
pub struct UserSinkIntegration {
    pub id: usize,
    pub settings: UserSinkIntegrationSetting,
    /// the date and time it was added on
    pub timestamp: DateTimeUtc,
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, FromJsonQueryResult)]
pub struct UserSinkIntegrations(pub Vec<UserSinkIntegration>);

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
    },
    PushBullet {
        api_token: String,
    },
    PushOver {
        key: String,
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

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, FromJsonQueryResult)]
pub struct UserNotifications(pub Vec<UserNotification>);
