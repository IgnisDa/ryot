use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use env_utils::APP_VERSION;
use reqwest::header::HeaderValue;

pub const PROJECT_NAME: &str = "ryot";
pub const AUTHOR: &str = "ignisda";
pub const AUTHOR_EMAIL: &str = "ignisda2001@gmail.com";
pub const USER_AGENT_STR: &str = const_str::concat!(
    AUTHOR,
    "/",
    PROJECT_NAME,
    "-v",
    APP_VERSION,
    " (",
    AUTHOR_EMAIL,
    ")"
);
pub const COMPILATION_TIMESTAMP: i64 = compile_time::unix!();
pub const AVATAR_URL: &str =
    "https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/icon-512x512.png";
pub const TEMP_DIR: &str = "tmp";
pub const SHOW_SPECIAL_SEASON_NAMES: [&str; 2] = ["Specials", "Extras"];
pub static APPLICATION_JSON_HEADER: HeaderValue = HeaderValue::from_static("application/json");
pub const FRONTEND_OAUTH_ENDPOINT: &str = "/api/auth";

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

/// Determine whether a feature is enabled
pub trait IsFeatureEnabled {
    fn is_enabled(&self) -> bool {
        true
    }
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

pub fn convert_naive_to_utc(d: NaiveDate) -> DateTime<Utc> {
    DateTime::from_naive_utc_and_offset(
        NaiveDateTime::new(d, NaiveTime::from_hms_opt(0, 0, 0).unwrap()),
        Utc,
    )
}
