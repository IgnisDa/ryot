use async_graphql::{Enum, SimpleObject};
use common_models::MediaStateChanged;
use fitness_models::UserUnitSystem;
use sea_orm::{FromJsonQueryResult, Iterable};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use strum::EnumString;

const WATCH_PROVIDERS: [&str; 8] = [
    "Netflix",
    "Amazon Prime",
    "Disney+",
    "HBO Max",
    "Apple TV",
    "Peacock",
    "Hulu",
    "Crunchyroll",
];

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserNotificationsPreferences {
    pub to_send: Vec<MediaStateChanged>,
    pub enabled: bool,
}

impl Default for UserNotificationsPreferences {
    fn default() -> Self {
        Self {
            to_send: MediaStateChanged::iter().collect(),
            enabled: true,
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
    pub people: bool,
    pub groups: bool,
    pub genres: bool,
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
            people: true,
            groups: true,
            genres: true,
        }
    }
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserOthersFeaturesEnabledPreferences {
    pub collections: bool,
    pub calendar: bool,
}

impl Default for UserOthersFeaturesEnabledPreferences {
    fn default() -> Self {
        Self {
            calendar: true,
            collections: true,
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
    pub templates: bool,
}

impl Default for UserFitnessFeaturesEnabledPreferences {
    fn default() -> Self {
        Self {
            enabled: true,
            measurements: true,
            workouts: true,
            templates: true,
        }
    }
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserExercisePreferences {
    pub unit_system: UserUnitSystem,
}

impl Default for UserExercisePreferences {
    fn default() -> Self {
        Self {
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
    pub others: UserOthersFeaturesEnabledPreferences,
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
    ThreePointSmiley,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, Eq, PartialEq, FromJsonQueryResult, Copy)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DashboardElementLot {
    Upcoming,
    InProgress,
    Summary,
    Recommendations,
    Activity,
}

#[skip_serializing_none]
#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
#[serde(rename_all = "camelCase")]
pub struct UserGeneralDashboardElement {
    pub section: DashboardElementLot,
    pub hidden: bool,
    pub num_elements: Option<u64>,
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserGeneralPreferences {
    pub display_nsfw: bool,
    pub disable_videos: bool,
    pub disable_reviews: bool,
    pub persist_queries: bool,
    pub watch_providers: Vec<String>,
    pub review_scale: UserReviewScale,
    pub disable_watch_providers: bool,
    pub disable_integrations: bool,
    pub disable_navigation_animation: bool,
    pub dashboard: Vec<UserGeneralDashboardElement>,
}

impl Default for UserGeneralPreferences {
    fn default() -> Self {
        Self {
            review_scale: UserReviewScale::default(),
            display_nsfw: true,
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
                    section: DashboardElementLot::Recommendations,
                    hidden: false,
                    num_elements: Some(8),
                },
                UserGeneralDashboardElement {
                    section: DashboardElementLot::Activity,
                    hidden: false,
                    num_elements: None,
                },
            ],
            persist_queries: true,
            disable_integrations: false,
            disable_navigation_animation: false,
            disable_videos: false,
            disable_watch_providers: false,
            watch_providers: WATCH_PROVIDERS.into_iter().map(|s| s.to_owned()).collect(),
            disable_reviews: false,
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

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, FromJsonQueryResult)]
#[serde(tag = "t", content = "d")]
pub enum NotificationPlatformSpecifics {
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
    Email {
        email: String,
    },
    Telegram {
        bot_token: String,
        chat_id: String,
    },
}
