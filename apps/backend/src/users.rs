use async_graphql::{Enum, SimpleObject};
use kinded::Kinded;
use sea_orm::{prelude::DateTimeUtc, FromJsonQueryResult};
use serde::{Deserialize, Serialize};
use strum::EnumString;

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserNotificationsPreferences {
    #[serde(default)]
    pub status_changed: bool,
    #[serde(default)]
    pub episode_released: bool,
    #[serde(default)]
    pub release_date_changed: bool,
    #[serde(default)]
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
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserMediaFeaturesEnabledPreferences {
    // FIXME: Remove these
    #[serde(default)]
    pub enabled: bool,
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
    pub music: bool,
    #[serde(default)]
    pub podcast: bool,
    #[serde(default)]
    pub show: bool,
    #[serde(default)]
    pub video_game: bool,
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
            music: true,
            podcast: true,
            show: true,
            video_game: true,
        }
    }
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserFitnessFeaturesEnabledPreferences {
    #[serde(default)]
    pub enabled: bool,
}

impl Default for UserFitnessFeaturesEnabledPreferences {
    fn default() -> Self {
        Self { enabled: true }
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
pub enum UserDistanceUnit {
    #[default]
    Kilometer,
    Mile,
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserExercisePreferences {
    #[serde(default)]
    pub save_history: usize,
    #[serde(default)]
    pub distance_unit: UserDistanceUnit,
    #[serde(default)]
    pub weight_unit: UserWeightUnit,
}

impl Default for UserExercisePreferences {
    fn default() -> Self {
        Self {
            save_history: 15,
            distance_unit: UserDistanceUnit::Kilometer,
            weight_unit: UserWeightUnit::Kilogram,
        }
    }
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserMeasurementsInBuiltPreferences {
    #[serde(default)]
    pub weight: bool,
    #[serde(default)]
    pub body_mass_index: bool,
    #[serde(default)]
    pub total_body_water: bool,
    #[serde(default)]
    pub muscle: bool,
    #[serde(default)]
    pub body_fat: bool,
    #[serde(default)]
    pub waist_to_height_ratio: bool,
    #[serde(default)]
    pub waist_to_hip_ratio: bool,
    #[serde(default)]
    pub basal_metabolic_rate: bool,
    #[serde(default)]
    pub total_daily_energy_expenditure: bool,
    #[serde(default)]
    pub calories: bool,
    #[serde(default)]
    pub lean_body_mass: bool,
    #[serde(default)]
    pub bone_mass: bool,
    #[serde(default)]
    pub visceral_fat: bool,
    #[serde(default)]
    pub waist_circumference: bool,
    #[serde(default)]
    pub hip_circumference: bool,
    #[serde(default)]
    pub chest_circumference: bool,
    #[serde(default)]
    pub thigh_circumference: bool,
    #[serde(default)]
    pub biceps_circumference: bool,
    #[serde(default)]
    pub neck_circumference: bool,
    #[serde(default)]
    pub body_fat_caliper: bool,
    #[serde(default)]
    pub chest_skinfold: bool,
    #[serde(default)]
    pub abdominal_skinfold: bool,
    #[serde(default)]
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
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
#[serde(rename_all = "camelCase")]
pub struct UserCustomMeasurement {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub data_type: UserCustomMeasurementDataType,
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserMeasurementsPreferences {
    #[serde(default)]
    pub custom: Vec<UserCustomMeasurement>,
    #[serde(default)]
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
    #[serde(default)]
    pub media: UserMediaFeaturesEnabledPreferences,
    #[serde(default)]
    pub fitness: UserFitnessFeaturesEnabledPreferences,
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

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, FromJsonQueryResult)]
pub struct UserNotifications(pub Vec<UserNotification>);
