use anyhow::{anyhow, Result};
use confique::Config;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
pub struct DatabaseConfig {
    #[config(default = "sqlite:./app.db?mode=rwc")]
    pub url: String,
}

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
pub struct OpenlibraryConfig {
    #[config(default = "https://openlibrary.org")]
    pub url: String,
    #[config(default = "https://covers.openlibrary.org/b")]
    pub cover_image: String,
}

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
pub struct BookConfig {
    pub openlibrary: OpenlibraryConfig,
}

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
pub struct SchedulerConfig {}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {}
    }
}

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
pub struct WebConfig {
    #[config(default = ["http://localhost:3000"])]
    pub cors_origins: Vec<String>,
}

#[derive(Deserialize, Debug, Clone, Serialize, Config)]
pub struct AppConfig {
    #[config(nested)]
    pub database: DatabaseConfig,
    #[config(nested)]
    pub books: BookConfig,
    #[config(nested)]
    pub scheduler: SchedulerConfig,
    #[config(nested)]
    pub web: WebConfig,
}

/// Get the configuration to be used in this application.
pub fn get_app_config() -> Result<AppConfig> {
    let config = "config";
    let app = "trackona";
    AppConfig::builder()
        .env()
        .file(format!("{config}/{app}.json"))
        .file(format!("{config}/{app}.toml"))
        .file(format!("{config}/{app}.yaml"))
        .load()
        .map_err(|e| anyhow!(e))
}
