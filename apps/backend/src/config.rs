use figment::{
    providers::{Env, Format, Json, Serialized, Toml, Yaml},
    Figment,
};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct DatabaseConfig {
    pub url: String,
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self {
            url: "sqlite:./app.db?mode=rwc".to_owned(),
        }
    }
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct OpenlibraryConfig {
    pub url: String,
    pub cover_image: String,
}

impl Default for OpenlibraryConfig {
    fn default() -> Self {
        Self {
            url: "https://openlibrary.org".to_owned(),
            cover_image: "https://covers.openlibrary.org/b".to_owned(),
        }
    }
}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct BookConfig {
    pub openlibrary: OpenlibraryConfig,
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct SchedulerConfig {}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {}
    }
}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct AppConfig {
    #[serde(default)]
    pub database: DatabaseConfig,
    #[serde(default)]
    pub books: BookConfig,
    #[serde(default)]
    pub scheduler: SchedulerConfig,
}

/// Get the figment configuration that is used across the apps.
pub fn get_figment_config() -> Figment {
    let config = "config";
    let app = "trackona";
    Figment::new()
        .merge(Serialized::defaults(AppConfig::default()))
        .merge(Env::raw().split("_"))
        .merge(Json::file(format!("{config}/{app}.json")))
        .merge(Toml::file(format!("{config}/{app}.toml")))
        .merge(Yaml::file(format!("{config}/{app}.yaml")))
}
