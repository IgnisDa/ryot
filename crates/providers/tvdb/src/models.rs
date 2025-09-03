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

impl TvdbSearchResponse {
    pub fn get_pagination(&self, page: i32) -> (Option<i32>, i32) {
        let next_page = self
            .links
            .as_ref()
            .and_then(|l| l.next.as_ref())
            .is_some()
            .then(|| page + 1);
        let total_items = self.links.as_ref().and_then(|l| l.total_items).unwrap_or(0);
        (next_page, total_items)
    }
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

pub type TvdbLanguagesApiResponse = TvdbApiResponse<Vec<TvdbLanguage>>;
pub type TvdbSeasonExtendedResponse = TvdbApiResponse<TvdbSeasonExtended>;
pub type TvdbMovieExtendedResponse = TvdbApiResponse<TvdbMovieExtendedItem>;
pub type TvdbShowExtendedResponse = TvdbApiResponse<TvdbSeriesExtendedItem>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TvdbListItem {
    pub id: i32,
    pub name: Option<String>,
    pub image: Option<String>,
    pub is_official: Option<bool>,
}
