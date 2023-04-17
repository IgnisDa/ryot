use figment::{
    providers::{Env, Format, Json, Toml, Yaml},
    Figment,
};
use serde::Deserialize;

#[derive(Deserialize, Debug, Clone, Default)]
pub struct DatabaseConfig {
    pub url: String,
}

#[derive(Deserialize, Debug, Clone, Default)]
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

#[derive(Deserialize, Debug, Clone, Default)]
pub struct BookConfig {
    pub openlibrary: OpenlibraryConfig,
}

// #[derive(Deserialize, Debug, Clone, Serialize)]
// pub struct SchedulerConfig {}

#[derive(Deserialize, Debug, Clone, Default)]
pub struct AppConfig {
    pub database: DatabaseConfig,
    pub books: BookConfig,
    // pub scheduler: SchedulerConfig,
}

/// Get the figment configuration that is used across the apps.
pub fn get_figment_config() -> Figment {
    let config = "config";
    let app = "trackona";
    Figment::new()
        .merge(Env::raw().split("_"))
        .merge(Json::file(format!("{config}/{app}.json")))
        .merge(Toml::file(format!("{config}/{app}.toml")))
        .merge(Yaml::file(format!("{config}/{app}.yaml")))
}
