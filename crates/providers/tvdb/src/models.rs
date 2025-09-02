use common_models::IdAndNamedObject;
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
pub struct TvdbSearchItem {
    pub tvdb_id: String,
    pub name: Option<String>,
    pub title: Option<String>,
    pub poster: Option<String>,
    pub image_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbSearchResponse {
    pub data: Vec<TvdbSearchItem>,
    pub links: Option<TvdbSearchLinks>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbExtendedArtwork {
    pub image: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbExtendedTrailer {
    pub url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TvdbExtendedCharacter {
    pub id: Option<i32>,
    pub name: Option<String>,
    pub people_type: Option<String>,
    pub person_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbExtendedItem {
    pub year: Option<String>,
    pub runtime: Option<i32>,
    pub name: Option<String>,
    pub title: Option<String>,
    pub image: Option<String>,
    pub image_url: Option<String>,
    pub overview: Option<String>,
    pub first_air_date: Option<String>,
    pub original_language: Option<String>,
    pub genres: Option<Vec<IdAndNamedObject>>,
    pub studios: Option<Vec<IdAndNamedObject>>,
    pub artworks: Option<Vec<TvdbExtendedArtwork>>,
    pub trailers: Option<Vec<TvdbExtendedTrailer>>,
    pub characters: Option<Vec<TvdbExtendedCharacter>>,
}

pub type TvdbMovieExtendedResponse = TvdbApiResponse<TvdbExtendedItem>;
