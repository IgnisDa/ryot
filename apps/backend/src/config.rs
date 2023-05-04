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

/// Determine whether a feature is enabled
pub trait IsFeatureEnabled {
    fn is_enabled(&self) -> bool {
        true
    }
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct DatabaseConfig {
    pub url: String,
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self {
            url: "sqlite:/data/trackona.db?mode=rwc".to_owned(),
        }
    }
}

#[derive(Deserialize, Debug, Clone, Serialize, Display)]
pub enum OpenlibraryCoverImageSize {
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
    pub cover_image_url: String,
    pub cover_image_size: OpenlibraryCoverImageSize,
}

impl Default for OpenlibraryConfig {
    fn default() -> Self {
        Self {
            url: "https://openlibrary.org".to_owned(),
            cover_image_url: "https://covers.openlibrary.org/b".to_owned(),
            cover_image_size: OpenlibraryCoverImageSize::Medium,
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

impl IsFeatureEnabled for BookConfig {}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct AudibleConfig {
    pub url: String,
}

impl Default for AudibleConfig {
    fn default() -> Self {
        Self {
            url: "https://api.audible.com/1.0/catalog/products/".to_owned()
        }
    }
}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct AudioBookConfig {
    pub audible: AudibleConfig
}

impl IsFeatureEnabled for AudioBookConfig {}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct MovieConfig {
    pub tmdb: TmdbConfig,
}

impl IsFeatureEnabled for MovieConfig {}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct ShowConfig {
    pub tmdb: TmdbConfig,
}

impl IsFeatureEnabled for ShowConfig {}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct SchedulerConfig {}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct WebConfig {
    pub cors_origins: Vec<String>,
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct TwitchConfig {
    pub client_id: String,
    pub client_secret: String,
    // Endpoint used to get access tokens which will be used by IGDB
    pub access_token_url: String
}

impl Default for TwitchConfig {
    fn default() -> Self {
        Self {
            client_id: "".to_owned(),
            client_secret: "".to_owned(),
            access_token_url: "https://id.twitch.tv/oauth2/token".to_owned()
        }
    }
}

#[derive(Deserialize, Debug, Clone, Serialize, Display)]
pub enum IgdbImageSize {
    #[strum(serialize = "t_original")]
    Original,
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct IgdbConfig {
    pub base_url: String,
    pub images_base_url: String,
    pub image_size: IgdbImageSize
}

impl Default for IgdbConfig {
    fn default() -> Self {
        Self {
            base_url: "https://api.igdb.com/v4/".to_owned(),
            images_base_url: "https://images.igdb.com/igdb/image/upload/".to_owned(),
            image_size: IgdbImageSize::Original
        }
    }
}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct VideoGameConfig {
    pub twitch: TwitchConfig,
    pub igdb: IgdbConfig
}

impl IsFeatureEnabled for  VideoGameConfig {
    fn is_enabled(&self) -> bool {
        let mut enabled = false;
        if !self.twitch.client_id.is_empty() && !self.twitch.client_secret.is_empty() {
            enabled = true;
        }
        enabled
    }
}

#[derive(Deserialize, Debug, Clone, Serialize, Default)]
pub struct AppConfig {
    #[serde(default)]
    pub database: DatabaseConfig,
    #[serde(default)]
    pub audio_books: AudioBookConfig,
    #[serde(default)]
    pub books: BookConfig,
    #[serde(default)]
    pub movies: MovieConfig,
    #[serde(default)]
    pub shows: ShowConfig,
    #[serde(default)]
    pub video_games: VideoGameConfig,
    #[serde(default)]
    pub scheduler: SchedulerConfig,
    #[serde(default)]
    pub web: WebConfig,
}

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
