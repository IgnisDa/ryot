use chrono::NaiveDate;
use common_models::{IdObject, NamedObject};
use dependent_models::MetadataPersonRelated;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub static URL: &str = "https://api.themoviedb.org/3";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TmdbCredit {
    pub id: Option<i32>,
    pub job: Option<String>,
    pub name: Option<String>,
    pub title: Option<String>,
    pub character: Option<String>,
    pub media_type: Option<String>,
    pub poster_path: Option<String>,
    pub known_for_department: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TmdbCreditsResponse {
    pub cast: Vec<TmdbCredit>,
    pub crew: Vec<TmdbCredit>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TmdbImage {
    pub file_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TmdbImagesResponse {
    pub logos: Option<Vec<TmdbImage>>,
    pub posters: Option<Vec<TmdbImage>>,
    pub profiles: Option<Vec<TmdbImage>>,
    pub backdrops: Option<Vec<TmdbImage>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TmdbEntry {
    pub id: i32,
    #[serde(alias = "name")]
    pub title: Option<String>,
    #[serde(alias = "logo_path", alias = "profile_path")]
    pub poster_path: Option<String>,
    pub release_date: Option<String>,
    pub first_air_date: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct TmdbListResponse {
    pub page: i32,
    pub total_pages: i32,
    pub total_results: i32,
    pub results: Vec<TmdbEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TmdbVideo {
    pub key: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TmdbVideoResults {
    pub results: Vec<TmdbVideo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TmdbSeasonNumber {
    pub season_number: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TmdbMediaEntry {
    pub id: i32,
    pub adult: Option<bool>,
    pub runtime: Option<i32>,
    pub name: Option<String>,
    pub title: Option<String>,
    pub status: Option<String>,
    pub overview: Option<String>,
    pub poster_path: Option<String>,
    pub release_date: Option<String>,
    pub vote_average: Option<Decimal>,
    pub backdrop_path: Option<String>,
    pub first_air_date: Option<String>,
    pub genres: Option<Vec<NamedObject>>,
    pub videos: Option<TmdbVideoResults>,
    pub original_language: Option<String>,
    pub seasons: Option<Vec<TmdbSeasonNumber>>,
    pub belongs_to_collection: Option<IdObject>,
    pub production_companies: Option<Vec<TmdbNonMediaEntity>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TmdbWatchProviderDetails {
    pub provider_name: String,
    pub logo_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TmdbWatchProviderList {
    pub buy: Option<Vec<TmdbWatchProviderDetails>>,
    pub rent: Option<Vec<TmdbWatchProviderDetails>>,
    pub flatrate: Option<Vec<TmdbWatchProviderDetails>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TmdbWatchProviderResponse {
    pub results: HashMap<String, TmdbWatchProviderList>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TmdbFindByExternalSourceResponse {
    pub tv_results: Vec<TmdbEntry>,
    pub movie_results: Vec<TmdbEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TmdbNonMediaEntity {
    pub id: i32,
    pub name: String,
    pub gender: Option<u8>,
    pub homepage: Option<String>,
    pub biography: Option<String>,
    pub description: Option<String>,
    pub birthday: Option<NaiveDate>,
    pub deathday: Option<NaiveDate>,
    pub origin_country: Option<String>,
    pub place_of_birth: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TmdbEpisode {
    pub id: i32,
    pub name: String,
    pub episode_number: i32,
    pub runtime: Option<i32>,
    pub overview: Option<String>,
    pub air_date: Option<String>,
    pub still_path: Option<String>,
    pub guest_stars: Vec<TmdbCredit>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TmdbSeason {
    pub id: i32,
    pub name: String,
    pub season_number: i32,
    pub air_date: Option<String>,
    pub overview: Option<String>,
    pub episodes: Vec<TmdbEpisode>,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TmdbSeasonCredit {
    pub cast: Vec<TmdbCredit>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TmdbCollection {
    pub id: i32,
    pub name: String,
    pub overview: Option<String>,
    pub parts: Vec<TmdbMediaEntry>,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TmdbImageConfiguration {
    pub secure_base_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TmdbConfiguration {
    pub images: TmdbImageConfiguration,
}

pub async fn fetch_company_media_by_type(
    media_type: String,
    identifier: &str,
    base: &crate::tmdb::base::TmdbService,
) -> anyhow::Result<Vec<MetadataPersonRelated>> {
    use enum_models::MediaLot;
    use enum_models::MediaSource;
    use media_models::PartialMetadataWithoutId;
    use serde_json::json;

    let lot = match media_type.as_str() {
        "movie" => MediaLot::Movie,
        "tv" => MediaLot::Show,
        _ => unreachable!(),
    };

    base.fetch_paginated_data(
        format!("{}/discover/{}", URL, &media_type),
        json!({
            "with_companies": identifier,
            "page": 1,
            "language": base.language
        }),
        None,
        |entry| async move {
            Some(MetadataPersonRelated {
                role: "Production Company".to_owned(),
                metadata: PartialMetadataWithoutId {
                    source: MediaSource::Tmdb,
                    identifier: entry.id.to_string(),
                    title: entry.title.unwrap_or_default(),
                    image: entry.poster_path.map(|p| base.get_image_url(p)),
                    lot,
                    ..Default::default()
                },
                ..Default::default()
            })
        },
    )
    .await
}
