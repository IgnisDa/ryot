use std::{convert::TryInto, fmt};

use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use data_encoding::BASE32;
use enum_models::MediaSource;
use env_utils::APP_VERSION;
use rand::{RngCore, rng};
use reqwest::header::HeaderValue;
use sea_orm::prelude::DateTimeUtc;
use serde::de;
use tokio::time::{Duration, sleep};

pub const PAGE_SIZE: i32 = 20;
pub const AUTHOR: &str = "ignisda";
pub const PROJECT_NAME: &str = "ryot";
pub const TWO_FACTOR_BACKUP_CODES_COUNT: u8 = 12;
pub const FRONTEND_OAUTH_ENDPOINT: &str = "/api/auth";
pub const AUTHOR_EMAIL: &str = "ignisda2001@gmail.com";
pub const BULK_APPLICATION_UPDATE_CHUNK_SIZE: usize = 5;
pub const MAX_IMPORT_RETRIES_FOR_PARTIAL_STATE: usize = 5;
pub const BULK_DATABASE_UPDATE_OR_DELETE_CHUNK_SIZE: usize = 2000;
pub const SHOW_SPECIAL_SEASON_NAMES: [&str; 2] = ["Specials", "Extras"];
pub const APPLICATION_JSON_HEADER: HeaderValue = HeaderValue::from_static("application/json");
pub const AVATAR_URL: &str =
    "https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/icon-512x512.png";
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

pub const PEOPLE_SEARCH_SOURCES: [MediaSource; 11] = [
    MediaSource::Tmdb,
    MediaSource::Anilist,
    MediaSource::Vndb,
    MediaSource::Openlibrary,
    MediaSource::Audible,
    MediaSource::MangaUpdates,
    MediaSource::Igdb,
    MediaSource::YoutubeMusic,
    MediaSource::Hardcover,
    MediaSource::GiantBomb,
    MediaSource::Spotify,
];

pub const MEDIA_SOURCES_WITHOUT_RECOMMENDATIONS: [MediaSource; 5] = [
    MediaSource::Vndb,
    MediaSource::Itunes,
    MediaSource::Custom,
    MediaSource::Spotify,
    MediaSource::GoogleBooks,
];

/// Logging macro that targets the "ryot" tracing target
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

pub fn get_temporary_directory() -> &'static str {
    if cfg!(debug_assertions) {
        return "/tmp";
    }
    "tmp"
}

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

pub fn convert_naive_to_utc(d: NaiveDate) -> DateTimeUtc {
    DateTime::from_naive_utc_and_offset(
        NaiveDateTime::new(d, NaiveTime::from_hms_opt(0, 0, 0).unwrap()),
        Utc,
    )
}

pub fn convert_naive_to_utc_datetime(d: NaiveDateTime) -> DateTimeUtc {
    DateTime::from_naive_utc_and_offset(d, Utc)
}

pub fn deserialize_date<'de, D>(deserializer: D) -> Result<NaiveDate, D::Error>
where
    D: de::Deserializer<'de>,
{
    struct JsonStringVisitor;

    impl de::Visitor<'_> for JsonStringVisitor {
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

pub fn generate_session_id(byte_length: Option<usize>) -> String {
    let length = byte_length.unwrap_or(32);
    let mut token_bytes = vec![0u8; length];
    rng().fill_bytes(&mut token_bytes);
    BASE32.encode(&token_bytes)
}
