use dependent_models::TvdbLanguage;
use serde::Deserialize;

pub static URL: &str = "https://api4.thetvdb.com/v4";

#[derive(Debug, Deserialize)]
pub struct TvdbApiResponse<T> {
    pub data: T,
}

pub type TvdbLanguagesApiResponse = TvdbApiResponse<Vec<TvdbLanguage>>;

#[derive(Debug, Deserialize)]
pub struct TvdbLoginData {
    pub token: String,
}

pub type TvdbLoginResponse = TvdbApiResponse<TvdbLoginData>;
