use reqwest::header::HeaderValue;

pub const PROJECT_NAME: &str = "ryot";
pub const AUTHOR: &str = "ignisda";
pub const AUTHOR_EMAIL: &str = "ignisda2001@gmail.com";
#[cfg(debug_assertions)]
pub const VERSION: &str = dotenvy_macro::dotenv!("APP_VERSION");
#[cfg(not(debug_assertions))]
pub const VERSION: &str = env!("APP_VERSION");
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
pub static BASE_DIR: &str = env!("CARGO_MANIFEST_DIR");
pub const COMPILATION_TIMESTAMP: i64 = compile_time::unix!();
pub const AVATAR_URL: &str =
    "https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/icon-512x512.png";
pub const TEMP_DIR: &str = "tmp";
pub const SHOW_SPECIAL_SEASON_NAMES: [&str; 2] = ["Specials", "Extras"];
pub static APPLICATION_JSON_HEADER: HeaderValue = HeaderValue::from_static("application/json");
pub const FRONTEND_OAUTH_ENDPOINT: &str = "/api/auth";
