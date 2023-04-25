use anyhow::{anyhow, Result};
use figment::{
    providers::{Env, Format, Json, Serialized, Toml, Yaml},
    Figment,
};
use serde::{Deserialize, Serialize};
use strum::Display;

static TMDB_BASE_URL: &str = "https://api.themoviedb.org/3/";

static TMDB_ACCESS_KEY: &str = 
"eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI4ZGVlOTZjMjc0OGVhY2U0NzU2MGJkMWU4YzE5NTljMCIsInN1YiI6IjY0NDRiYmE4MmM2YjdiMDRiZTdlZDJmNSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.ZZZNJMXStvAOPJlT0hOBVPSTppFAK3mcUpmbJsExIq4";

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

#[derive(Deserialize, Debug, Clone, Serialize, Display)]
pub enum OpenlibraryCoverImageSizes {
    #[strum(serialize = "S")]
    Small,
    #[strum(serialize = "M")]
    Medium,
    #[strum(serialize = "L")]
    Large,
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct OpenlibraryConfig {
    pub url: String,
    pub cover_image: String,
    pub cover_image_size: OpenlibraryCoverImageSizes,
}

impl Default for OpenlibraryConfig {
    fn default() -> Self {
        Self {
            url: "https://openlibrary.org".to_owned(),
            cover_image: "https://covers.openlibrary.org/b".to_owned(),
            cover_image_size: OpenlibraryCoverImageSizes::Medium,
        }
    }
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct TmdbConfig {
    pub url: String,
    pub access_token: String,
}

impl Default for TmdbConfig {
    fn default() -> Self {
        Self {
            url: TMDB_BASE_URL.to_owned(),
            access_token: TMDB_ACCESS_KEY.to_owned()
        }
    }
}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct BookConfig {
    pub openlibrary: OpenlibraryConfig,
}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct MovieConfig {
    pub tmdb: TmdbConfig,
}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct ShowConfig {
    pub tmdb: TmdbConfig,
}

#[derive(Deserialize, Debug, Clone, Serialize)]
#[derive(Default)]
pub struct SchedulerConfig {}



#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct WebConfig {
    pub cors_origins: Vec<String>,
}

impl Default for WebConfig {
    fn default() -> Self {
        Self {
            cors_origins: vec!["http://localhost:3000".to_owned()],
        }
    }
}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct AppConfig {
    #[serde(default)]
    pub database: DatabaseConfig,
    #[serde(default)]
    pub books: BookConfig,
    #[serde(default)]
    pub movies: MovieConfig,
    #[serde(default)]
    pub shows: ShowConfig,
    #[serde(default)]
    pub scheduler: SchedulerConfig,
    #[serde(default)]
    pub web: WebConfig,
}

/// Get the figment configuration that is used across the apps.
pub fn get_app_config() -> Result<AppConfig> {
    let config = "config";
    let app = "trackona";
    Figment::new()
        .merge(Serialized::defaults(AppConfig::default()))
        .merge(Env::raw().split("_"))
        .merge(Json::file(format!("{config}/{app}.json")))
        .merge(Toml::file(format!("{config}/{app}.toml")))
        .merge(Yaml::file(format!("{config}/{app}.yaml")))
        .extract()
        .map_err(|e| anyhow!(e))
}
