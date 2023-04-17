use figment::{providers::Env, Figment};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct DatabaseConfig {
    pub url: String,
}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct OpenlibraryConfig {
    #[serde(default = "OpenlibraryConfig::url")]
    pub url: String,
}

impl OpenlibraryConfig {
    pub fn url() -> String {
        "https://openlibrary.org".to_owned()
    }
}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct BookConfig {
    pub openlibrary: OpenlibraryConfig,
}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub enum SchedulerMode {
    #[default]
    #[serde(rename = "sqlite")]
    Sqlite,
    #[serde(rename = "mysql")]
    Mysql,
    #[serde(rename = "postgres")]
    Postgres,
}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct SchedulerConfig {
    pub mode: SchedulerMode,
    pub url: String,
}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct AppConfig {
    pub db: DatabaseConfig,
    pub book: BookConfig,
    pub scheduler: SchedulerConfig,
}

/// Get the figment configuration that is used across the apps.
pub fn get_figment_config() -> Figment {
    Figment::new().merge(Env::prefixed("APP_").split("__"))
}
