use async_graphql::{Enum, SimpleObject};
use common_models::MediaStateChanged;
use educe::Educe;
use enums::MediaLot;
use fitness_models::{SetRestTimersSettings, UserUnitSystem};
use sea_orm::{FromJsonQueryResult, Iterable};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use strum::EnumString;

const MOVIE_WATCH_PROVIDERS: [&str; 8] = [
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
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult, Educe,
)]
#[educe(Default)]
pub struct UserNotificationsPreferences {
    #[educe(Default(expression = MediaStateChanged::iter().collect()))]
    pub to_send: Vec<MediaStateChanged>,
    #[educe(Default = true)]
    pub enabled: bool,
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult, Educe,
)]
#[educe(Default)]
pub struct UserMediaFeaturesEnabledPreferences {
    #[educe(Default = true)]
    pub enabled: bool,
    #[educe(Default = true)]
    pub anime: bool,
    #[educe(Default = true)]
    pub audio_book: bool,
    #[educe(Default = true)]
    pub book: bool,
    #[educe(Default = true)]
    pub manga: bool,
    #[educe(Default = true)]
    pub movie: bool,
    #[educe(Default = true)]
    pub podcast: bool,
    #[educe(Default = true)]
    pub show: bool,
    #[educe(Default = true)]
    pub video_game: bool,
    #[educe(Default = true)]
    pub visual_novel: bool,
    #[educe(Default = true)]
    pub people: bool,
    #[educe(Default = true)]
    pub groups: bool,
    #[educe(Default = true)]
    pub genres: bool,
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult, Educe,
)]
#[educe(Default)]
pub struct UserOthersFeaturesEnabledPreferences {
    #[educe(Default = true)]
    pub collections: bool,
    #[educe(Default = true)]
    pub calendar: bool,
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult, Educe,
)]
#[educe(Default)]
pub struct UserFitnessFeaturesEnabledPreferences {
    #[educe(Default = true)]
    pub enabled: bool,
    #[educe(Default = true)]
    pub measurements: bool,
    #[educe(Default = true)]
    pub workouts: bool,
    #[educe(Default = true)]
    pub templates: bool,
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult, Educe,
)]
#[educe(Default)]
pub struct UserFitnessLoggingPreferences {
    #[educe(Default = true)]
    pub show_details_while_editing: bool,
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult, Educe,
)]
#[educe(Default)]
pub struct UserFitnessExercisesPreferences {
    #[educe(Default = UserUnitSystem::Metric)]
    pub unit_system: UserUnitSystem,
    pub set_rest_timers: SetRestTimersSettings,
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult, Educe,
)]
#[educe(Default)]
pub struct UserMeasurementsInBuiltPreferences {
    #[educe(Default = true)]
    pub weight: bool,
    #[educe(Default = true)]
    pub body_mass_index: bool,
    #[educe(Default = true)]
    pub total_body_water: bool,
    #[educe(Default = true)]
    pub muscle: bool,
    #[educe(Default = true)]
    pub body_fat: bool,
    #[educe(Default = true)]
    pub waist_to_height_ratio: bool,
    #[educe(Default = true)]
    pub waist_to_hip_ratio: bool,
    #[educe(Default = true)]
    pub basal_metabolic_rate: bool,
    #[educe(Default = true)]
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
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult, Educe,
)]
#[educe(Default)]
pub struct UserFitnessMeasurementsPreferences {
    #[educe(Default(expression = vec![UserCustomMeasurement {
        name: "sugar_level".to_owned(),
        data_type: UserCustomMeasurementDataType::Decimal,
    }]))]
    pub custom: Vec<UserCustomMeasurement>,
    #[educe(Default(expression = UserMeasurementsInBuiltPreferences::default()))]
    pub inbuilt: UserMeasurementsInBuiltPreferences,
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
    pub logging: UserFitnessLoggingPreferences,
    pub exercises: UserFitnessExercisesPreferences,
    pub measurements: UserFitnessMeasurementsPreferences,
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
pub enum GridPacking {
    Normal,
    #[default]
    Dense,
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

#[skip_serializing_none]
#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
#[serde(rename_all = "camelCase")]
pub struct UserGeneralWatchProvider {
    pub lot: MediaLot,
    pub values: Vec<String>,
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult, Educe,
)]
#[educe(Default)]
pub struct UserGeneralPreferences {
    #[educe(Default = true)]
    pub display_nsfw: bool,
    #[educe(Default = false)]
    pub disable_videos: bool,
    #[educe(Default = false)]
    pub disable_reviews: bool,
    #[educe(Default = true)]
    pub persist_queries: bool,
    #[educe(Default(expression = vec![UserGeneralWatchProvider {
        lot: MediaLot::Movie,
        values: MOVIE_WATCH_PROVIDERS
            .into_iter()
            .map(|s| s.to_owned())
            .collect(),
    }]))]
    pub watch_providers: Vec<UserGeneralWatchProvider>,
    #[educe(Default = GridPacking::Dense)]
    pub grid_packing: GridPacking,
    #[educe(Default = UserReviewScale::OutOfHundred)]
    pub review_scale: UserReviewScale,
    #[educe(Default = false)]
    pub disable_watch_providers: bool,
    #[educe(Default = false)]
    pub disable_integrations: bool,
    #[educe(Default = false)]
    pub disable_navigation_animation: bool,
    #[educe(Default(expression = vec![
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
    ]))]
    pub dashboard: Vec<UserGeneralDashboardElement>,
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, Default, FromJsonQueryResult,
)]
pub struct UserPreferences {
    pub fitness: UserFitnessPreferences,
    pub general: UserGeneralPreferences,
    pub notifications: UserNotificationsPreferences,
    pub features_enabled: UserFeaturesEnabledPreferences,
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
