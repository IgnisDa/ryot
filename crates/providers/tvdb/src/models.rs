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

#[derive(Debug, Deserialize)]
pub struct TvdbSearchLinks {
    pub next: Option<String>,
    pub total_items: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbSearchResult {
    pub id: String,
    pub name: Option<String>,
    pub year: Option<String>,
    pub title: Option<String>,
    pub poster: Option<String>,
    pub image_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbSearchResponse {
    pub data: Vec<TvdbSearchResult>,
    pub links: Option<TvdbSearchLinks>,
}
