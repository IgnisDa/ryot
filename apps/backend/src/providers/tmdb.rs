use std::{fs, path::PathBuf};

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chrono::NaiveDate;
use database::{MetadataLot, MetadataSource};
use hashbag::HashBag;
use itertools::Itertools;
use rs_utils::{convert_date_to_year, convert_string_to_date};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};
use serde_json::json;
use surf::{http::headers::AUTHORIZATION, Client};

use crate::{
    entities::metadata_group::MetadataGroupWithoutId,
    models::{
        media::{
            MediaDetails, MediaSearchItem, MediaSpecifics, MetadataImage,
            MetadataImageForMediaDetails, MetadataImageLot, MetadataPerson, MetadataVideo,
            MetadataVideoSource, MovieSpecifics, PartialMetadataPerson, PartialMetadataWithoutId,
            ShowEpisode, ShowSeason, ShowSpecifics,
        },
        IdObject, NamedObject, SearchDetails, SearchResults, StoredUrl,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::{get_base_http_client, TEMP_DIR},
};

static URL: &str = "https://api.themoviedb.org/3/";
static FILE: &str = "tmdb.json";
static POSSIBLE_ROLES: [&str; 4] = ["Acting", "Production", "Directing", "Director"];

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Settings {
    image_url: String,
    languages: Vec<TmdbLanguage>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TmdbLanguage {
    iso_639_1: String,
    english_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TmdbCredit {
    id: Option<i32>,
    name: Option<String>,
    title: Option<String>,
    media_type: Option<String>,
    known_for_department: Option<String>,
    job: Option<String>,
    character: Option<String>,
    profile_path: Option<String>,
    poster_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TmdbCreditsResponse {
    cast: Vec<TmdbCredit>,
    crew: Vec<TmdbCredit>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TmdbImage {
    file_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TmdbImagesResponse {
    backdrops: Option<Vec<TmdbImage>>,
    posters: Option<Vec<TmdbImage>>,
    logos: Option<Vec<TmdbImage>>,
    profiles: Option<Vec<TmdbImage>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct TmdbEntry {
    id: i32,
    poster_path: Option<String>,
    backdrop_path: Option<String>,
    overview: Option<String>,
    title: Option<String>,
    name: Option<String>,
    release_date: Option<String>,
    first_air_date: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct TmdbListResponse<T = TmdbEntry> {
    page: i32,
    total_results: i32,
    results: Vec<T>,
    total_pages: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TmdbVideo {
    key: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TmdbVideoResults {
    results: Vec<TmdbVideo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TmdbSeasonNumber {
    season_number: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TmdbMediaEntry {
    id: i32,
    name: Option<String>,
    original_language: Option<String>,
    title: Option<String>,
    adult: Option<bool>,
    vote_average: Option<Decimal>,
    overview: Option<String>,
    poster_path: Option<String>,
    backdrop_path: Option<String>,
    release_date: Option<String>,
    first_air_date: Option<String>,
    production_companies: Option<Vec<TmdbNonMediaEntity>>,
    seasons: Option<Vec<TmdbSeasonNumber>>,
    runtime: Option<i32>,
    status: Option<String>,
    genres: Option<Vec<NamedObject>>,
    belongs_to_collection: Option<IdObject>,
    videos: Option<TmdbVideoResults>,
}

#[derive(Debug, Clone)]
pub struct TmdbService {
    language: String,
    settings: Settings,
}

impl TmdbService {
    fn get_cover_image_url(&self, c: String) -> String {
        format!("{}{}{}", self.settings.image_url, "original", c)
    }

    fn get_language_name(&self, iso: Option<String>) -> Option<String> {
        iso.and_then(|i| {
            self.settings
                .languages
                .iter()
                .find(|l| l.iso_639_1 == i)
                .map(|l| l.english_name.clone())
        })
    }
}

impl MediaProviderLanguages for TmdbService {
    fn supported_languages() -> Vec<String> {
        isolang::languages()
            .filter_map(|l| l.to_639_1().map(String::from))
            .collect()
    }

    fn default_language() -> String {
        "en".to_owned()
    }
}

#[derive(Debug, Clone)]
pub struct NonMediaTmdbService {
    client: Client,
    base: TmdbService,
}

impl NonMediaTmdbService {
    pub async fn new(access_token: String, language: String) -> Self {
        let (client, settings) = get_client_config(URL, &access_token).await;
        Self {
            client,
            base: TmdbService { language, settings },
        }
    }
}

#[async_trait]
impl MediaProvider for NonMediaTmdbService {
    async fn person_details(&self, identity: &PartialMetadataPerson) -> Result<MetadataPerson> {
        let typ = "person".to_owned();
        let details: TmdbNonMediaEntity = self
            .client
            .get(format!("{}/{}", typ, identity.identifier))
            .await
            .map_err(|e| anyhow!(e))?
            .body_json()
            .await
            .map_err(|e| anyhow!(e))?;
        let mut images = vec![];
        self.base
            .save_all_images(&self.client, &typ, &identity.identifier, &mut images)
            .await?;
        let images = images
            .into_iter()
            .unique()
            .map(|p| self.base.get_cover_image_url(p))
            .collect();
        let description = details.description.or(details.biography);
        let mut related = vec![];
        let cred_det: TmdbCreditsResponse = self
            .client
            .get(format!("{}/{}/combined_credits", typ, identity.identifier))
            .query(&json!({ "language": self.base.language }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?
            .body_json()
            .await
            .map_err(|e| anyhow!(e))?;
        for media in cred_det.crew.into_iter().chain(cred_det.cast.into_iter()) {
            if let Some(title) = media.title.or(media.name) {
                if let Some(job) = media.character {
                    if POSSIBLE_ROLES.contains(&job.as_str()) {
                        related.push((
                            job,
                            PartialMetadataWithoutId {
                                identifier: media.id.unwrap().to_string(),
                                title,
                                image: media.poster_path.map(|p| self.base.get_cover_image_url(p)),
                                lot: match media.media_type.unwrap().as_ref() {
                                    "movie" => MetadataLot::Movie,
                                    "tv" => MetadataLot::Show,
                                    _ => continue,
                                },
                                source: MetadataSource::Tmdb,
                            },
                        ));
                    }
                }
            }
        }
        let resp = MetadataPerson {
            name: details.name,
            images: Some(images),
            identifier: details.id.to_string(),
            description: description.and_then(|s| if s.as_str() == "" { None } else { Some(s) }),
            source: MetadataSource::Tmdb,
            place: details.origin_country.or(details.place_of_birth),
            website: details.homepage,
            birth_date: details.birthday,
            death_date: details.deathday,
            gender: details.gender.and_then(|g| match g {
                1 => Some("Female".to_owned()),
                2 => Some("Male".to_owned()),
                3 => Some("Non-Binary".to_owned()),
                _ => None,
            }),
            related,
        };
        Ok(resp)
    }
}

#[derive(Debug, Clone)]
pub struct TmdbMovieService {
    client: Client,
    base: TmdbService,
}

impl TmdbMovieService {
    pub async fn new(config: &config::TmdbConfig, _page_limit: i32) -> Self {
        let (client, settings) = get_client_config(URL, &config.access_token).await;
        Self {
            client,
            base: TmdbService {
                language: config.locale.clone(),
                settings,
            },
        }
    }
}

#[async_trait]
impl MediaProvider for TmdbMovieService {
    async fn group_details(
        &self,
        identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbCollection {
            id: i32,
            name: String,
            overview: Option<String>,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            parts: Vec<TmdbMediaEntry>,
        }
        let data: TmdbCollection = self
            .client
            .get(format!("collection/{}", &identifier))
            .query(&json!({ "language": self.base.language }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?
            .body_json()
            .await
            .map_err(|e| anyhow!(e))?;
        let mut images = vec![];
        if let Some(i) = data.poster_path {
            images.push(i);
        }
        if let Some(i) = data.backdrop_path {
            images.push(i);
        }
        self.base
            .save_all_images(&self.client, "collection", identifier, &mut images)
            .await?;
        let parts = data
            .parts
            .into_iter()
            .map(|p| PartialMetadataWithoutId {
                title: p.title.unwrap(),
                identifier: p.id.to_string(),
                source: MetadataSource::Tmdb,
                lot: MetadataLot::Movie,
                image: p.poster_path.map(|p| self.base.get_cover_image_url(p)),
            })
            .collect_vec();
        Ok((
            MetadataGroupWithoutId {
                display_images: vec![],
                parts: parts.len().try_into().unwrap(),
                identifier: identifier.to_owned(),
                title: replace_from_end(data.name, " Collection", ""),
                description: data.overview,
                images: images
                    .into_iter()
                    .unique()
                    .map(|p| MetadataImage {
                        url: StoredUrl::Url(self.base.get_cover_image_url(p)),
                        lot: MetadataImageLot::Poster,
                    })
                    .collect(),
                lot: MetadataLot::Movie,
                source: MetadataSource::Tmdb,
            },
            parts,
        ))
    }

    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let mut rsp = self
            .client
            .get(format!("movie/{}", &identifier))
            .query(&json!({
                "language": self.base.language,
                "append_to_response": "videos",
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let data: TmdbMediaEntry = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let mut videos = vec![];
        if let Some(vid) = data.videos {
            videos.extend(vid.results.into_iter().map(|vid| MetadataVideo {
                identifier: StoredUrl::Url(vid.key),
                source: MetadataVideoSource::Youtube,
            }))
        }
        let mut rsp = self
            .client
            .get(format!("movie/{}/credits", identifier))
            .query(&json!({
                "language": self.base.language,
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let credits: TmdbCreditsResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let mut people = vec![];
        people.extend(
            credits
                .cast
                .clone()
                .into_iter()
                .flat_map(|g| {
                    if let Some(id) = g.id {
                        if let Some(r) = g.known_for_department {
                            if POSSIBLE_ROLES.contains(&r.as_str()) {
                                Some(PartialMetadataPerson {
                                    identifier: id.to_string(),
                                    role: r,
                                    source: MetadataSource::Tmdb,
                                    character: g.character,
                                })
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                })
                .unique()
                .collect_vec(),
        );
        people.extend(
            credits
                .crew
                .clone()
                .into_iter()
                .flat_map(|g| {
                    if let Some(id) = g.id {
                        if let Some(r) = g.known_for_department {
                            if POSSIBLE_ROLES.contains(&r.as_str()) {
                                Some(PartialMetadataPerson {
                                    identifier: id.to_string(),
                                    role: r,
                                    source: MetadataSource::Tmdb,
                                    character: g.character,
                                })
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                })
                .unique()
                .collect_vec(),
        );
        people.extend(
            data.production_companies
                .unwrap_or_default()
                .into_iter()
                .map(|p| PartialMetadataPerson {
                    identifier: p.id.to_string(),
                    role: "Production".to_owned(),
                    source: MetadataSource::Tmdb,
                    character: None,
                })
                .collect_vec(),
        );
        let mut image_ids = Vec::from_iter(data.poster_path);
        if let Some(u) = data.backdrop_path {
            image_ids.push(u);
        }
        self.base
            .save_all_images(&self.client, "movie", identifier, &mut image_ids)
            .await?;
        let suggestions = self
            .base
            .save_all_suggestions(&self.client, "movie", identifier)
            .await?;

        Ok(MediaDetails {
            identifier: data.id.to_string(),
            is_nsfw: data.adult,
            original_language: self.base.get_language_name(data.original_language),
            lot: MetadataLot::Movie,
            source: MetadataSource::Tmdb,
            production_status: data.status,
            title: data.title.unwrap(),
            genres: data
                .genres
                .unwrap_or_default()
                .into_iter()
                .map(|g| g.name)
                .collect(),
            people,
            url_images: image_ids
                .into_iter()
                .unique()
                .map(|p| MetadataImageForMediaDetails {
                    image: self.base.get_cover_image_url(p),
                    lot: MetadataImageLot::Poster,
                })
                .collect(),
            videos,
            publish_year: data
                .release_date
                .as_ref()
                .and_then(|r| convert_date_to_year(r)),
            publish_date: data.release_date.and_then(|r| convert_string_to_date(&r)),
            description: data.overview,
            specifics: MediaSpecifics::Movie(MovieSpecifics {
                runtime: data.runtime,
            }),
            suggestions,
            provider_rating: if let Some(av) = data.vote_average {
                if av != dec!(0) {
                    Some(av * dec!(10))
                } else {
                    None
                }
            } else {
                None
            },
            creators: vec![],
            s3_images: vec![],
            group_identifiers: Vec::from_iter(data.belongs_to_collection)
                .into_iter()
                .map(|c| c.id.to_string())
                .collect(),
        })
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
        display_nsfw: bool,
    ) -> Result<SearchResults<MediaSearchItem>> {
        let page = page.unwrap_or(1);
        let mut rsp = self
            .client
            .get("search/movie")
            .query(&json!({
                "query": query.to_owned(),
                "page": page,
                "language": self.base.language,
                "include_adult": display_nsfw,
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: TmdbListResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;

        let resp = search
            .results
            .into_iter()
            .map(|d| MediaSearchItem {
                identifier: d.id.to_string(),
                title: d.title.unwrap(),
                publish_year: convert_date_to_year(&d.release_date.unwrap()),
                image: d.poster_path.map(|p| self.base.get_cover_image_url(p)),
            })
            .collect_vec();
        let next_page = if page < search.total_pages {
            Some(page + 1)
        } else {
            None
        };
        Ok(SearchResults {
            details: SearchDetails {
                total: search.total_results,
                next_page,
            },
            items: resp.to_vec(),
        })
    }
}

#[derive(Debug, Clone)]
pub struct TmdbShowService {
    client: Client,
    base: TmdbService,
}

impl TmdbShowService {
    pub async fn new(config: &config::TmdbConfig, _page_limit: i32) -> Self {
        let (client, settings) = get_client_config(URL, &config.access_token).await;
        Self {
            client,
            base: TmdbService {
                language: config.locale.clone(),
                settings,
            },
        }
    }
}

#[async_trait]
impl MediaProvider for TmdbShowService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let mut rsp = self
            .client
            .get(format!("tv/{}", &identifier))
            .query(&json!({
                "language": self.base.language,
                "append_to_response": "videos",
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let show_data: TmdbMediaEntry = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let mut videos = vec![];
        if let Some(vid) = show_data.videos {
            videos.extend(vid.results.into_iter().map(|vid| MetadataVideo {
                identifier: StoredUrl::Url(vid.key),
                source: MetadataVideoSource::Youtube,
            }))
        }
        let mut image_ids = Vec::from_iter(show_data.poster_path);
        if let Some(u) = show_data.backdrop_path {
            image_ids.push(u);
        }
        self.base
            .save_all_images(&self.client, "tv", identifier, &mut image_ids)
            .await?;
        let suggestions = self
            .base
            .save_all_suggestions(&self.client, "tv", identifier)
            .await?;

        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbEpisode {
            id: i32,
            name: String,
            episode_number: i32,
            still_path: Option<String>,
            overview: Option<String>,
            air_date: Option<String>,
            runtime: Option<i32>,
            guest_stars: Vec<TmdbCredit>,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbSeason {
            id: i32,
            name: String,
            overview: Option<String>,
            poster_path: Option<String>,
            backdrop_path: Option<String>,
            air_date: Option<String>,
            season_number: i32,
            episodes: Vec<TmdbEpisode>,
        }
        let mut seasons = vec![];
        for s in show_data.seasons.unwrap_or_default().iter() {
            let mut rsp = self
                .client
                .get(format!(
                    "tv/{}/season/{}",
                    identifier.to_owned(),
                    s.season_number
                ))
                .query(&json!({
                    "language": self.base.language,
                }))
                .unwrap()
                .await
                .map_err(|e| anyhow!(e))?;
            let mut data: TmdbSeason = rsp.body_json().await.map_err(|e| anyhow!(e))?;
            let mut rsp = self
                .client
                .get(format!(
                    "tv/{}/season/{}/credits",
                    identifier.to_owned(),
                    s.season_number
                ))
                .query(&json!({
                    "language": self.base.language,
                }))
                .unwrap()
                .await
                .map_err(|e| anyhow!(e))?;
            #[derive(Debug, Serialize, Deserialize, Clone)]
            struct TmdbSeasonCredit {
                cast: Vec<TmdbCredit>,
            }
            let credits: TmdbSeasonCredit = rsp.body_json().await.map_err(|e| anyhow!(e))?;
            for e in data.episodes.iter_mut() {
                e.guest_stars.extend(credits.cast.clone());
            }
            seasons.push(data);
        }
        let mut people = seasons
            .iter()
            .flat_map(|s| {
                s.episodes
                    .iter()
                    .flat_map(|e| {
                        e.guest_stars
                            .clone()
                            .into_iter()
                            .flat_map(|g| {
                                if let Some(id) = g.id {
                                    g.known_for_department.map(|r| PartialMetadataPerson {
                                        identifier: id.to_string(),
                                        role: r,
                                        source: MetadataSource::Tmdb,
                                        character: g.character,
                                    })
                                } else {
                                    None
                                }
                            })
                            .collect_vec()
                    })
                    .collect_vec()
            })
            .collect_vec();
        people.extend(
            show_data
                .production_companies
                .unwrap_or_default()
                .into_iter()
                .map(|p| PartialMetadataPerson {
                    identifier: p.id.to_string(),
                    role: "Production".to_owned(),
                    source: MetadataSource::Tmdb,
                    character: None,
                })
                .collect_vec(),
        );
        let people: HashBag<PartialMetadataPerson> = HashBag::from_iter(people);
        let people = Vec::from_iter(people.set_iter())
            .into_iter()
            .sorted_by_key(|c| c.1)
            .rev()
            .map(|c| c.0)
            .filter(|c| POSSIBLE_ROLES.contains(&c.role.as_str()))
            .cloned()
            .collect_vec();
        Ok(MediaDetails {
            identifier: show_data.id.to_string(),
            title: show_data.name.unwrap(),
            is_nsfw: show_data.adult,
            original_language: self.base.get_language_name(show_data.original_language),
            lot: MetadataLot::Show,
            production_status: show_data.status,
            source: MetadataSource::Tmdb,
            description: show_data.overview,
            people,
            genres: show_data
                .genres
                .unwrap_or_default()
                .into_iter()
                .map(|g| g.name)
                .unique()
                .collect(),
            publish_date: convert_string_to_date(
                &show_data.first_air_date.clone().unwrap_or_default(),
            ),
            url_images: image_ids
                .into_iter()
                .unique()
                .map(|p| MetadataImageForMediaDetails {
                    image: self.base.get_cover_image_url(p),
                    lot: MetadataImageLot::Poster,
                })
                .collect(),
            videos,
            publish_year: convert_date_to_year(&show_data.first_air_date.unwrap_or_default()),
            specifics: MediaSpecifics::Show(ShowSpecifics {
                seasons: seasons
                    .into_iter()
                    .map(|s| {
                        let poster_images =
                            Vec::from_iter(s.poster_path.map(|p| self.base.get_cover_image_url(p)));
                        let backdrop_images = Vec::from_iter(
                            s.backdrop_path.map(|p| self.base.get_cover_image_url(p)),
                        );
                        ShowSeason {
                            id: s.id,
                            name: s.name,
                            publish_date: convert_string_to_date(&s.air_date.unwrap_or_default()),
                            overview: s.overview,
                            poster_images,
                            backdrop_images,
                            season_number: s.season_number,
                            episodes: s
                                .episodes
                                .into_iter()
                                .map(|e| {
                                    let poster_images = Vec::from_iter(
                                        e.still_path.map(|p| self.base.get_cover_image_url(p)),
                                    );
                                    ShowEpisode {
                                        id: e.id,
                                        name: e.name,
                                        runtime: e.runtime,
                                        publish_date: convert_string_to_date(
                                            &e.air_date.unwrap_or_default(),
                                        ),
                                        overview: e.overview,
                                        episode_number: e.episode_number,
                                        poster_images,
                                    }
                                })
                                .collect(),
                        }
                    })
                    .collect(),
            }),
            suggestions,
            provider_rating: if let Some(av) = show_data.vote_average {
                if av != dec!(0) {
                    Some(av * dec!(10))
                } else {
                    None
                }
            } else {
                None
            },
            group_identifiers: vec![],
            creators: vec![],
            s3_images: vec![],
        })
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
        display_nsfw: bool,
    ) -> Result<SearchResults<MediaSearchItem>> {
        let page = page.unwrap_or(1);
        let mut rsp = self
            .client
            .get("search/tv")
            .query(&json!({
                "query": query.to_owned(),
                "page": page,
                "language": self.base.language,
                "include_adult": display_nsfw,
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: TmdbListResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let resp = search
            .results
            .into_iter()
            .map(|d| MediaSearchItem {
                identifier: d.id.to_string(),
                title: d.name.unwrap(),
                publish_year: convert_date_to_year(&d.first_air_date.unwrap()),
                image: d.poster_path.map(|p| self.base.get_cover_image_url(p)),
            })
            .collect_vec();
        let next_page = if page < search.total_pages {
            Some(page + 1)
        } else {
            None
        };
        Ok(SearchResults {
            details: SearchDetails {
                total: search.total_results,
                next_page,
            },
            items: resp.to_vec(),
        })
    }
}

async fn get_client_config(url: &str, access_token: &str) -> (Client, Settings) {
    let client: Client =
        get_base_http_client(url, vec![(AUTHORIZATION, format!("Bearer {access_token}"))]);
    let path = PathBuf::new().join(TEMP_DIR).join(FILE);
    let tmdb_settings = if !path.exists() {
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbImageConfiguration {
            secure_base_url: String,
        }
        #[derive(Debug, Serialize, Deserialize, Clone)]
        struct TmdbConfiguration {
            images: TmdbImageConfiguration,
        }
        let mut rsp = client.get("configuration").await.unwrap();
        let data_1: TmdbConfiguration = rsp.body_json().await.unwrap();
        let mut rsp = client.get("configuration/languages").await.unwrap();
        let data_2: Vec<TmdbLanguage> = rsp.body_json().await.unwrap();
        let tmdb_settings = Settings {
            image_url: data_1.images.secure_base_url,
            languages: data_2,
        };
        let data_to_write = serde_json::to_string(&tmdb_settings);
        fs::write(path, data_to_write.unwrap()).unwrap();
        tmdb_settings
    } else {
        let data = fs::read_to_string(path).unwrap();
        serde_json::from_str(&data).unwrap()
    };
    (client, tmdb_settings)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TmdbNonMediaEntity {
    id: i32,
    name: String,
    biography: Option<String>,
    description: Option<String>,
    birthday: Option<NaiveDate>,
    deathday: Option<NaiveDate>,
    homepage: Option<String>,
    gender: Option<u8>,
    origin_country: Option<String>,
    place_of_birth: Option<String>,
}

impl TmdbService {
    async fn save_all_images(
        &self,
        client: &Client,
        typ: &str,
        identifier: &str,
        images: &mut Vec<String>,
    ) -> Result<()> {
        let mut rsp = client
            .get(format!("{}/{}/images", typ, identifier))
            .await
            .map_err(|e| anyhow!(e))?;
        let new_images: TmdbImagesResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        if let Some(imgs) = new_images.posters {
            for image in imgs {
                images.push(image.file_path);
            }
        }
        if let Some(imgs) = new_images.backdrops {
            for image in imgs {
                images.push(image.file_path);
            }
        }
        if let Some(imgs) = new_images.logos {
            for image in imgs {
                images.push(image.file_path);
            }
        }
        if let Some(imgs) = new_images.profiles {
            for image in imgs {
                images.push(image.file_path);
            }
        }
        Ok(())
    }

    async fn save_all_suggestions(
        &self,
        client: &Client,
        typ: &str,
        identifier: &str,
    ) -> Result<Vec<PartialMetadataWithoutId>> {
        let lot = match typ {
            "movie" => MetadataLot::Movie,
            "tv" => MetadataLot::Show,
            _ => unreachable!(),
        };
        let mut suggestions = vec![];
        for page in 1.. {
            let new_recs: TmdbListResponse = client
                .get(format!("{}/{}/recommendations", typ, identifier))
                .query(&json!({ "page": page }))
                .unwrap()
                .await
                .map_err(|e| anyhow!(e))?
                .body_json()
                .await
                .map_err(|e| anyhow!(e))?;
            for entry in new_recs.results.into_iter() {
                let name = if let Some(n) = entry.name {
                    n
                } else if let Some(n) = entry.title {
                    n
                } else {
                    continue;
                };
                suggestions.push(PartialMetadataWithoutId {
                    title: name,
                    image: entry.poster_path.map(|p| self.get_cover_image_url(p)),
                    identifier: entry.id.to_string(),
                    source: MetadataSource::Tmdb,
                    lot,
                });
            }
            if new_recs.page >= new_recs.total_pages {
                break;
            }
        }
        Ok(suggestions)
    }
}

fn replace_from_end(input_string: String, search_string: &str, replace_string: &str) -> String {
    if let Some(last_index) = input_string.rfind(search_string) {
        let mut modified_string = input_string.clone();
        let end = last_index + search_string.len();
        modified_string.replace_range(last_index..end, replace_string);
        return modified_string;
    }
    input_string
}
