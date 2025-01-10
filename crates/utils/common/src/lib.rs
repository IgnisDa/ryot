use std::{convert::TryInto, fmt};

use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use enum_models::{ExerciseLot, MediaLot, MediaSource, WorkoutSetPersonalBest};
use env_utils::APP_VERSION;
use reqwest::header::HeaderValue;
use serde::de;
use tokio::time::{sleep, Duration};

pub const PROJECT_NAME: &str = "ryot";
pub const AUTHOR: &str = "ignisda";
pub const AUTHOR_EMAIL: &str = "ignisda2001@gmail.com";
pub const USER_AGENT_STR: &str = const_str::concat!(
    AUTHOR,
    "/",
    PROJECT_NAME,
    "-",
    APP_VERSION,
    " (",
    AUTHOR_EMAIL,
    ")"
);
pub const COMPILATION_TIMESTAMP: i64 = compile_time::unix!();
pub const AVATAR_URL: &str =
    "https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/icon-512x512.png";
#[cfg(not(debug_assertions))]
pub const TEMP_DIR: &str = "tmp";
#[cfg(debug_assertions)]
pub const TEMP_DIR: &str = "/tmp";
pub const SHOW_SPECIAL_SEASON_NAMES: [&str; 2] = ["Specials", "Extras"];
pub static APPLICATION_JSON_HEADER: HeaderValue = HeaderValue::from_static("application/json");
pub const FRONTEND_OAUTH_ENDPOINT: &str = "/api/auth";
pub const PAGE_SIZE: i32 = 20;
pub const EXERCISE_LOT_MAPPINGS: &[(ExerciseLot, &[WorkoutSetPersonalBest])] = &[
    (ExerciseLot::Duration, &[WorkoutSetPersonalBest::Time]),
    (
        ExerciseLot::DistanceAndDuration,
        &[WorkoutSetPersonalBest::Pace, WorkoutSetPersonalBest::Time],
    ),
    (
        ExerciseLot::RepsAndWeight,
        &[
            WorkoutSetPersonalBest::Weight,
            WorkoutSetPersonalBest::OneRm,
            WorkoutSetPersonalBest::Volume,
            WorkoutSetPersonalBest::Reps,
        ],
    ),
    (ExerciseLot::Reps, &[WorkoutSetPersonalBest::Reps]),
];
pub const METADATA_LOT_MAPPINGS: &[(MediaLot, &[MediaSource])] = &[
    (MediaLot::AudioBook, &[MediaSource::Audible]),
    (
        MediaLot::Book,
        &[
            MediaSource::Openlibrary,
            MediaSource::GoogleBooks,
            MediaSource::Hardcover,
        ],
    ),
    (
        MediaLot::Podcast,
        &[MediaSource::Itunes, MediaSource::Listennotes],
    ),
    (MediaLot::VideoGame, &[MediaSource::Igdb]),
    (MediaLot::Anime, &[MediaSource::Anilist, MediaSource::Mal]),
    (
        MediaLot::Manga,
        &[
            MediaSource::Anilist,
            MediaSource::MangaUpdates,
            MediaSource::Mal,
        ],
    ),
    (MediaLot::Movie, &[MediaSource::Tmdb]),
    (MediaLot::Music, &[MediaSource::YoutubeMusic]),
    (MediaLot::Show, &[MediaSource::Tmdb]),
    (MediaLot::VisualNovel, &[MediaSource::Vndb]),
];

pub const PEOPLE_SEARCH_SOURCES: [MediaSource; 8] = [
    MediaSource::Tmdb,
    MediaSource::Anilist,
    MediaSource::Vndb,
    MediaSource::Openlibrary,
    MediaSource::Audible,
    MediaSource::MangaUpdates,
    MediaSource::Igdb,
    MediaSource::YoutubeMusic,
];

pub const METADATA_GROUP_SOURCE_LOT_MAPPINGS: &[(MediaSource, MediaLot)] = &[
    (MediaSource::Tmdb, MediaLot::Movie),
    (MediaSource::Igdb, MediaLot::VideoGame),
    (MediaSource::YoutubeMusic, MediaLot::Music),
];

pub fn get_first_and_last_day_of_month(year: i32, month: u32) -> (NaiveDate, NaiveDate) {
    let first_day = NaiveDate::from_ymd_opt(year, month, 1).unwrap();
    let last_day = NaiveDate::from_ymd_opt(year, month + 1, 1)
        .unwrap_or_else(|| NaiveDate::from_ymd_opt(year + 1, 1, 1).unwrap())
        .pred_opt()
        .unwrap();

    (first_day, last_day)
}

pub fn convert_string_to_date(d: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()
}

pub fn convert_date_to_year(d: &str) -> Option<i32> {
    convert_string_to_date(d).map(|d| d.format("%Y").to_string().parse::<i32>().unwrap())
}

pub fn convert_naive_to_utc(d: NaiveDate) -> DateTime<Utc> {
    DateTime::from_naive_utc_and_offset(
        NaiveDateTime::new(d, NaiveTime::from_hms_opt(0, 0, 0).unwrap()),
        Utc,
    )
}

pub fn deserialize_date<'de, D>(deserializer: D) -> Result<NaiveDate, D::Error>
where
    D: de::Deserializer<'de>,
{
    struct JsonStringVisitor;

    impl<'de> de::Visitor<'de> for JsonStringVisitor {
        type Value = NaiveDate;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("a number")
        }

        fn visit_u64<E>(self, v: u64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            DateTime::from_timestamp_millis(v.try_into().unwrap())
                .ok_or_else(|| E::custom("Could not convert timestamp"))
                .map(|d| d.date_naive())
        }

        fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            NaiveDate::parse_from_str(v, "%Y-%m-%d")
                .map_err(|_| E::custom("Could not convert timestamp"))
        }
    }

    deserializer.deserialize_any(JsonStringVisitor)
}

pub async fn sleep_for_n_seconds(sec: u64) {
    sleep(Duration::from_secs(sec)).await;
}

#[macro_export]
macro_rules! ryot_log {
    (info, $($arg:tt)*) => {
        tracing::info!(target: "ryot", $($arg)*);
    };
    (warn, $($arg:tt)*) => {
        tracing::warn!(target: "ryot", $($arg)*);
    };
    (error, $($arg:tt)*) => {
        tracing::error!(target: "ryot", $($arg)*);
    };
    (debug, $($arg:tt)*) => {
        tracing::debug!(target: "ryot", $($arg)*);
    };
    (trace, $($arg:tt)*) => {
        tracing::trace!(target: "ryot", $($arg)*);
    };
}

#[macro_export]
macro_rules! acquire_lock {
    ($db:expr, $key:expr) => {
        use sqlx::postgres::PgAdvisoryLock;

        let key_string = serde_json::to_string($key).unwrap();
        let lock = PgAdvisoryLock::new(key_string);
        ryot_log!(debug, "Acquiring advisory lock: {:?}", lock);
        let conn = $db.get_postgres_connection_pool().acquire().await?;
        let acquired = lock.acquire(conn).await?;
    };
}
