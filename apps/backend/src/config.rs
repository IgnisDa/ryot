use figment::{providers::Env, Figment};
use serde::Deserialize;

#[derive(Deserialize, Debug, Clone, Default)]
pub struct DatabaseConfig {
    pub url: String,
}

#[derive(Deserialize, Debug, Clone, Default)]
pub struct AppConfig {
    pub db: DatabaseConfig,
}

/// Get the figment configuration that is used across the apps.
pub fn get_figment_config() -> Figment {
    Figment::new().merge(Env::prefixed("APP_").split("__"))
}
