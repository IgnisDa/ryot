use figment::{providers::Env, Figment};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct DatabaseConfig {
    pub url: String,
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct OpenlibraryConfig {
    #[serde(default = "OpenlibraryConfig::api_url")]
    pub url: String,
    #[serde(default = "OpenlibraryConfig::cover_image_url")]
    pub cover_image: String,
}

impl OpenlibraryConfig {
    pub fn api_url() -> String {
        "https://openlibrary.org".to_owned()
    }
    pub fn cover_image_url() -> String {
        "https://covers.openlibrary.org/b".to_owned()
    }
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct BookConfig {
    pub openlibrary: OpenlibraryConfig,
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct SchedulerConfig {}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct AppConfig {
    pub db: DatabaseConfig,
    pub book: BookConfig,
    pub scheduler: SchedulerConfig,
}

/// Get the figment configuration that is used across the apps.
pub fn get_figment_config() -> Figment {
    Figment::new().merge(Env::prefixed("APP_").split("__"))
}
