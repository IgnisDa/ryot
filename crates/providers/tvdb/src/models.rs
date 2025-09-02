use common_models::StringIdAndNamedObject;
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

pub type TvdbMovieExtendedResponse = TvdbApiResponse<TvdbItem>;

#[derive(Debug, Deserialize)]
pub struct TvdbSearchLinks {
    pub next: Option<String>,
    pub total_items: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbCharacter {
    pub id: Option<i32>,
    pub role: Option<String>,
    pub name: Option<String>,
    pub people_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbArtwork {
    pub image: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbTrailer {
    pub url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbItem {
    pub tvdb_id: String,
    pub score: Option<f64>,
    pub name: Option<String>,
    pub year: Option<String>,
    pub runtime: Option<i32>,
    pub title: Option<String>,
    pub poster: Option<String>,
    pub overview: Option<String>,
    pub image_url: Option<String>,
    pub genres: Option<Vec<String>>,
    pub first_air_date: Option<String>,
    pub original_language: Option<String>,
    pub artworks: Option<Vec<TvdbArtwork>>,
    pub trailers: Option<Vec<TvdbTrailer>>,
    pub characters: Option<Vec<TvdbCharacter>>,
    pub companies: Option<Vec<StringIdAndNamedObject>>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbSearchResponse {
    pub data: Vec<TvdbItem>,
    pub links: Option<TvdbSearchLinks>,
}
