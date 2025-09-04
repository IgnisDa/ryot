use chrono::NaiveDate;
use common_models::IdAndNamedObject;
use dependent_models::TvdbLanguage;
use serde::Deserialize;

pub static URL: &str = "https://api4.thetvdb.com/v4";

#[derive(Debug, Deserialize)]
pub struct TvdbApiResponse<T> {
    pub data: T,
}

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
    pub people_id: Option<i32>,
    pub name: Option<String>,
    pub people_type: Option<String>,
    pub person_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbShowEpisode {
    pub id: i32,
    pub number: i32,
    pub name: Option<String>,
    pub runtime: Option<i32>,
    pub aired: Option<String>,
    pub image: Option<String>,
    pub overview: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbSeasonType {
    #[serde(rename = "type")]
    pub season_type: String,
}

#[derive(Debug, Deserialize)]
pub struct TvdbSeasonArtwork {
    pub image: String,
}

#[derive(Debug, Deserialize)]
pub struct TvdbSeasonExtended {
    pub id: i32,
    pub number: i32,
    pub year: Option<String>,
    pub image: Option<String>,
    #[serde(rename = "type")]
    pub season_type: TvdbSeasonType,
    pub episodes: Vec<TvdbShowEpisode>,
    pub artwork: Option<Vec<TvdbSeasonArtwork>>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbShowSeason {
    pub id: i32,
    pub number: i32,
}

#[derive(Debug, Deserialize)]
pub struct TvdbCompanies {
    pub studio: Option<Vec<IdAndNamedObject>>,
    pub network: Option<Vec<IdAndNamedObject>>,
    pub production: Option<Vec<IdAndNamedObject>>,
    pub distributor: Option<Vec<IdAndNamedObject>>,
    pub special_effects: Option<Vec<IdAndNamedObject>>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbCompany {
    pub id: i32,
    pub name: String,
    #[serde(rename = "companyType")]
    pub company_type: Option<TvdbCompanyType>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbCompanyType {
    #[serde(rename = "companyTypeName")]
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct TvdbExtendedItemCommon {
    pub name: Option<String>,
    pub slug: Option<String>,
    pub year: Option<String>,
    pub image: Option<String>,
    pub overview: Option<String>,
    #[serde(rename = "firstAired")]
    pub first_air_date: Option<String>,
    pub original_language: Option<String>,
    pub genres: Option<Vec<IdAndNamedObject>>,
    pub artworks: Option<Vec<TvdbExtendedArtwork>>,
    pub trailers: Option<Vec<TvdbExtendedTrailer>>,
    pub characters: Option<Vec<TvdbExtendedCharacter>>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbMovieExtendedItem {
    #[serde(rename = "averageRuntime")]
    pub runtime: Option<i32>,
    pub title: Option<String>,
    pub image_url: Option<String>,
    #[serde(flatten)]
    pub common: TvdbExtendedItemCommon,
    pub companies: Option<TvdbCompanies>,
    pub lists: Option<Vec<TvdbListItem>>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbSeriesExtendedItem {
    pub id: Option<i32>,
    #[serde(flatten)]
    pub common: TvdbExtendedItemCommon,
    pub companies: Option<Vec<TvdbCompany>>,
    pub seasons: Option<Vec<TvdbShowSeason>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TvdbListEntityItem {
    pub order: i32,
    pub movie_id: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TvdbListItem {
    pub id: i32,
    pub url: Option<String>,
    pub name: Option<String>,
    pub image: Option<String>,
    pub overview: Option<String>,
    pub is_official: Option<bool>,
    pub entities: Option<Vec<TvdbListEntityItem>>,
}

#[derive(Debug, Deserialize)]
pub struct TvdbBiography {
    pub biography: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TvdbCharacter {
    pub name: Option<String>,
    pub movie_id: Option<i32>,
    pub image: Option<String>,
    pub series_id: Option<i32>,
    pub people_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TvdbPersonExtended {
    pub gender: Option<i32>,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub image: Option<String>,
    pub birth: Option<NaiveDate>,
    pub death: Option<NaiveDate>,
    pub birth_place: Option<String>,
    pub characters: Option<Vec<TvdbCharacter>>,
    pub biographies: Option<Vec<TvdbBiography>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TvdbCompanyExtended {
    pub name: Option<String>,
    pub slug: Option<String>,
    pub country: Option<String>,
}

pub type TvdbListDetailsResponse = TvdbApiResponse<TvdbListItem>;
pub type TvdbLanguagesApiResponse = TvdbApiResponse<Vec<TvdbLanguage>>;
pub type TvdbSeasonExtendedResponse = TvdbApiResponse<TvdbSeasonExtended>;
pub type TvdbPersonExtendedResponse = TvdbApiResponse<TvdbPersonExtended>;
pub type TvdbMovieExtendedResponse = TvdbApiResponse<TvdbMovieExtendedItem>;
pub type TvdbShowExtendedResponse = TvdbApiResponse<TvdbSeriesExtendedItem>;
pub type TvdbCompanyExtendedResponse = TvdbApiResponse<TvdbCompanyExtended>;
