use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use http_types::headers::HeaderName;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use surf::{
    http::headers::{ToHeaderValues, USER_AGENT},
    Client, Config, Url,
};

pub mod file_storage;
pub mod length_vec;

pub static BASE_DIR: &str = env!("CARGO_MANIFEST_DIR");
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const PROJECT_NAME: &str = env!("CARGO_PKG_NAME");
pub const COOKIE_NAME: &str = "auth";
pub const AUTHOR: &str = "ignisda";
pub const AUTHOR_EMAIL: &str = "ignisda2001@gmail.com";
pub const USER_AGENT_STR: &str = const_str::concat!(
    AUTHOR,
    "/",
    PROJECT_NAME,
    "-v",
    VERSION,
    " (",
    AUTHOR_EMAIL,
    ")"
);
pub const AVATAR_URL: &str =
    "https://raw.githubusercontent.com/IgnisDa/ryot/main/apps/frontend/public/icon-512x512.png";

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

pub fn get_now_timestamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("Time went backwards")
        .as_millis()
}

pub fn get_base_http_client(
    url: &str,
    headers: Vec<(impl Into<HeaderName>, impl ToHeaderValues)>,
) -> Client {
    let mut config = Config::new()
        .add_header(USER_AGENT, USER_AGENT_STR)
        .unwrap();
    for (header, value) in headers.into_iter() {
        config = config.add_header(header, value).unwrap();
    }
    config
        .set_base_url(Url::parse(url).unwrap())
        .try_into()
        .unwrap()
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, Hash)]
pub enum StoredUrl {
    S3(String),
    Url(String),
}

impl Default for StoredUrl {
    fn default() -> Self {
        Self::Url("".to_owned())
    }
}

pub async fn get_stored_asset(
    url: StoredUrl,
    file_storage_service: &Arc<file_storage::FileStorageService>,
) -> String {
    match url {
        StoredUrl::Url(u) => u,
        StoredUrl::S3(u) => file_storage_service.get_presigned_url(u).await,
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
