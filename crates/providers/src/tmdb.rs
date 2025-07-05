use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use anyhow::{Result, anyhow};
use application_utils::get_base_http_client;
use async_trait::async_trait;
use chrono::NaiveDate;
use common_models::{
    EntityAssets, EntityRemoteVideo, EntityRemoteVideoSource, IdObject, NamedObject,
    PersonSourceSpecifics, SearchDetails,
};
use common_utils::{SHOW_SPECIAL_SEASON_NAMES, convert_date_to_year, convert_string_to_date};
use database_models::metadata_group::MetadataGroupWithoutId;
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, MetadataPersonRelated, PersonDetails,
    SearchResults, TmdbLanguage, TmdbSettings,
};
use enum_models::{MediaLot, MediaSource};
use hashbag::HashBag;
use itertools::Itertools;
use media_models::{
    CommitMetadataGroupInput, MetadataDetails, MetadataExternalIdentifiers,
    MetadataGroupSearchItem, MetadataSearchItem, MovieSpecifics, PartialMetadataPerson,
    PartialMetadataWithoutId, PeopleSearchItem, ShowEpisode, ShowSeason, ShowSpecifics,
    UniqueMediaIdentifier, WatchProvider,
};
use reqwest::{
    Client,
    header::{AUTHORIZATION, HeaderValue},
};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};
use serde_json::json;
use supporting_service::SupportingService;
use traits::MediaProvider;

static URL: &str = "https://api.themoviedb.org/3";

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TmdbCredit {
    id: Option<i32>,
    job: Option<String>,
    name: Option<String>,
    title: Option<String>,
    character: Option<String>,
    media_type: Option<String>,
    poster_path: Option<String>,
    profile_path: Option<String>,
    known_for_department: Option<String>,
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
    logos: Option<Vec<TmdbImage>>,
    posters: Option<Vec<TmdbImage>>,
    profiles: Option<Vec<TmdbImage>>,
    backdrops: Option<Vec<TmdbImage>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct TmdbEntry {
    id: i32,
    #[serde(alias = "name")]
    title: Option<String>,
    overview: Option<String>,
    #[serde(alias = "logo_path", alias = "profile_path")]
    poster_path: Option<String>,
    release_date: Option<String>,
    first_air_date: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct TmdbListResponse {
    page: i32,
    total_pages: i32,
    total_results: i32,
    results: Vec<TmdbEntry>,
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
    adult: Option<bool>,
    runtime: Option<i32>,
    name: Option<String>,
    title: Option<String>,
    status: Option<String>,
    overview: Option<String>,
    poster_path: Option<String>,
    release_date: Option<String>,
    vote_average: Option<Decimal>,
    backdrop_path: Option<String>,
    first_air_date: Option<String>,
    genres: Option<Vec<NamedObject>>,
    videos: Option<TmdbVideoResults>,
    original_language: Option<String>,
    seasons: Option<Vec<TmdbSeasonNumber>>,
    belongs_to_collection: Option<IdObject>,
    production_companies: Option<Vec<TmdbNonMediaEntity>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct TmdbWatchProviderDetails {
    provider_id: i32,
    provider_name: String,
    logo_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct TmdbWatchProviderList {
    buy: Option<Vec<TmdbWatchProviderDetails>>,
    rent: Option<Vec<TmdbWatchProviderDetails>>,
    flatrate: Option<Vec<TmdbWatchProviderDetails>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct TmdbWatchProviderResponse {
    results: HashMap<String, TmdbWatchProviderList>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct TmdbFindByExternalSourceResponse {
    tv_results: Vec<TmdbEntry>,
    movie_results: Vec<TmdbEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TmdbNonMediaEntity {
    id: i32,
    name: String,
    gender: Option<u8>,
    homepage: Option<String>,
    biography: Option<String>,
    description: Option<String>,
    birthday: Option<NaiveDate>,
    deathday: Option<NaiveDate>,
    origin_country: Option<String>,
    place_of_birth: Option<String>,
}

pub struct TmdbService {
    client: Client,
    language: String,
    settings: TmdbSettings,
}

impl TmdbService {
    pub async fn new(ss: Arc<SupportingService>) -> Self {
        let access_token = &ss.config.movies_and_shows.tmdb.access_token;
        let client: Client = get_base_http_client(Some(vec![(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {access_token}")).unwrap(),
        )]));
        let settings = get_settings(&client, &ss).await.unwrap();
        Self {
            client,
            settings,
            language: ss.config.movies_and_shows.tmdb.locale.clone(),
        }
    }
}

impl TmdbService {
    fn get_image_url(&self, c: String) -> String {
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

    async fn save_all_images(
        &self,
        type_: &str,
        identifier: &str,
        images: &mut Vec<String>,
    ) -> Result<()> {
        let rsp = self
            .client
            .get(format!("{}/{}/{}/images", URL, type_, identifier))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let new_images: TmdbImagesResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
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

    async fn get_all_suggestions(
        &self,
        type_: &str,
        identifier: &str,
    ) -> Result<Vec<PartialMetadataWithoutId>> {
        let lot = match type_ {
            "movie" => MediaLot::Movie,
            "tv" => MediaLot::Show,
            _ => unreachable!(),
        };
        let mut suggestions = vec![];
        for page in 1.. {
            let new_recs: TmdbListResponse = self
                .client
                .get(format!("{}/{}/{}/recommendations", URL, type_, identifier))
                .query(&json!({ "page": page }))
                .send()
                .await
                .map_err(|e| anyhow!(e))?
                .json()
                .await
                .map_err(|e| anyhow!(e))?;
            for entry in new_recs.results.into_iter() {
                let name = match entry.title {
                    Some(n) => n,
                    _ => continue,
                };
                suggestions.push(PartialMetadataWithoutId {
                    lot,
                    title: name,
                    source: MediaSource::Tmdb,
                    identifier: entry.id.to_string(),
                    image: entry.poster_path.map(|p| self.get_image_url(p)),
                    ..Default::default()
                });
            }
            if new_recs.page >= new_recs.total_pages {
                break;
            }
        }
        Ok(suggestions)
    }

    async fn get_all_watch_providers(
        &self,
        type_: &str,
        identifier: &str,
    ) -> Result<Vec<WatchProvider>> {
        let watch_providers_with_langs: TmdbWatchProviderResponse = self
            .client
            .get(format!("{}/{}/{}/watch/providers", URL, type_, identifier))
            .query(&json!({ "language": self.language }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json()
            .await
            .map_err(|e| anyhow!(e))?;
        let mut watch_providers = Vec::<WatchProvider>::new();
        for (country, lang_providers) in watch_providers_with_langs.results {
            self.append_to_watch_provider(
                &mut watch_providers,
                lang_providers.rent,
                country.clone(),
            );
            self.append_to_watch_provider(
                &mut watch_providers,
                lang_providers.buy,
                country.clone(),
            );
            self.append_to_watch_provider(
                &mut watch_providers,
                lang_providers.flatrate,
                country.clone(),
            );
        }
        Ok(watch_providers)
    }

    fn append_to_watch_provider(
        &self,
        watch_providers: &mut Vec<WatchProvider>,
        maybe_provider: Option<Vec<TmdbWatchProviderDetails>>,
        country: String,
    ) {
        if let Some(provider) = maybe_provider {
            for provider in provider {
                let maybe_position = watch_providers
                    .iter()
                    .position(|p| p.name == provider.provider_name);
                if let Some(position) = maybe_position {
                    watch_providers[position].languages.insert(country.clone());
                } else {
                    watch_providers.push(WatchProvider {
                        name: provider.provider_name,
                        image: provider.logo_path.map(|i| self.get_image_url(i)),
                        languages: HashSet::from_iter(vec![country.clone()]),
                    });
                }
            }
        }
    }

    async fn get_external_identifiers(
        &self,
        type_: &str,
        identifier: &str,
    ) -> Result<MetadataExternalIdentifiers> {
        let rsp = self
            .client
            .get(format!("{}/{}/{}/external_ids", URL, type_, identifier))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        rsp.json().await.map_err(|e| anyhow!(e))
    }

    async fn get_trending_media(&self, media_type: &str) -> Result<Vec<PartialMetadataWithoutId>> {
        let mut trending = vec![];
        for page in 1..=3 {
            let rsp = self
                .client
                .get(format!("{}/trending/{}/day", URL, media_type))
                .query(&json!({
                    "page": page,
                    "language": self.language,
                }))
                .send()
                .await
                .map_err(|e| anyhow!(e))?;
            let data: TmdbListResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
            for entry in data.results.into_iter() {
                let title = match entry.title {
                    Some(n) => n,
                    _ => continue,
                };
                trending.push(PartialMetadataWithoutId {
                    title,
                    source: MediaSource::Tmdb,
                    identifier: entry.id.to_string(),
                    image: entry.poster_path.map(|p| self.get_image_url(p)),
                    lot: match media_type {
                        "movie" => MediaLot::Movie,
                        "tv" => MediaLot::Show,
                        _ => continue,
                    },
                    ..Default::default()
                });
            }
            if data.page >= data.total_pages {
                break;
            }
        }
        Ok(trending)
    }
}

pub struct NonMediaTmdbService {
    base: TmdbService,
}

impl NonMediaTmdbService {
    pub async fn new(ss: Arc<SupportingService>) -> Self {
        Self {
            base: TmdbService::new(ss).await,
        }
    }
}

#[async_trait]
impl MediaProvider for NonMediaTmdbService {
    async fn people_search(
        &self,
        query: &str,
        page: Option<i32>,
        display_nsfw: bool,
        source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let language = &self.base.language;
        let type_ = match source_specifics {
            Some(PersonSourceSpecifics {
                is_tmdb_company: Some(true),
                ..
            }) => "company",
            _ => "person",
        };
        let page = page.unwrap_or(1);
        let rsp = self
            .base
            .client
            .get(format!("{}/search/{}", URL, type_))
            .query(&json!({
                "page": page,
                "language": language,
                "query": query.to_owned(),
                "include_adult": display_nsfw,
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: TmdbListResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        let resp = search
            .results
            .into_iter()
            .map(|d| PeopleSearchItem {
                name: d.title.unwrap(),
                identifier: d.id.to_string(),
                image: d.poster_path.map(|p| self.base.get_image_url(p)),
                ..Default::default()
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

    async fn person_details(
        &self,
        identifier: &str,
        source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
        let type_ = match source_specifics {
            Some(PersonSourceSpecifics {
                is_tmdb_company: Some(true),
                ..
            }) => "company",
            _ => "person",
        };
        let details: TmdbNonMediaEntity = self
            .base
            .client
            .get(format!("{}/{}/{}", URL, type_, identifier))
            .query(&json!({ "language": self.base.language }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json()
            .await
            .map_err(|e| anyhow!(e))?;
        let mut images = vec![];
        self.base
            .save_all_images(type_, identifier, &mut images)
            .await?;
        let images = images
            .into_iter()
            .unique()
            .map(|p| self.base.get_image_url(p))
            .collect();
        let description = details.description.or(details.biography);
        let mut related_metadata = vec![];
        if type_ == "person" {
            let cred_det: TmdbCreditsResponse = self
                .base
                .client
                .get(format!("{}/{}/{}/combined_credits", URL, type_, identifier))
                .query(&json!({ "language": self.base.language }))
                .send()
                .await
                .map_err(|e| anyhow!(e))?
                .json()
                .await
                .map_err(|e| anyhow!(e))?;
            for media in cred_det.crew.into_iter().chain(cred_det.cast.into_iter()) {
                let role = media.job.unwrap_or_else(|| "Actor".to_owned());
                let metadata = PartialMetadataWithoutId {
                    source: MediaSource::Tmdb,
                    identifier: media.id.unwrap().to_string(),
                    title: media.title.or(media.name).unwrap_or_default(),
                    image: media.poster_path.map(|p| self.base.get_image_url(p)),
                    lot: match media.media_type.unwrap().as_ref() {
                        "movie" => MediaLot::Movie,
                        "tv" => MediaLot::Show,
                        _ => continue,
                    },
                    ..Default::default()
                };
                related_metadata.push(MetadataPersonRelated {
                    role,
                    metadata,
                    character: media.character,
                });
            }
        } else {
            for m_typ in ["movie", "tv"] {
                for i in 1.. {
                    let cred_det: TmdbListResponse = self.base
                        .client
                        .get(format!("{}/discover/{}", URL, m_typ))
                        .query(
                            &json!({ "with_companies": identifier, "page": i, "language": self.base.language }),
                        )
                        .send()
                        .await
                        .map_err(|e| anyhow!(e))?
                        .json()
                        .await
                        .map_err(|e| anyhow!(e))?;
                    related_metadata.extend(cred_det.results.into_iter().map(|m| {
                        MetadataPersonRelated {
                            role: "Production Company".to_owned(),
                            metadata: PartialMetadataWithoutId {
                                source: MediaSource::Tmdb,
                                identifier: m.id.to_string(),
                                title: m.title.unwrap_or_default(),
                                image: m.poster_path.map(|p| self.base.get_image_url(p)),
                                lot: match m_typ {
                                    "movie" => MediaLot::Movie,
                                    "tv" => MediaLot::Show,
                                    _ => unreachable!(),
                                },
                                ..Default::default()
                            },
                            ..Default::default()
                        }
                    }));
                    if cred_det.page == cred_det.total_pages {
                        break;
                    }
                }
            }
        }
        let name = details.name;
        let resp = PersonDetails {
            related_metadata,
            name: name.clone(),
            source: MediaSource::Tmdb,
            website: details.homepage,
            birth_date: details.birthday,
            death_date: details.deathday,
            identifier: details.id.to_string(),
            source_specifics: source_specifics.to_owned(),
            place: details.origin_country.or(details.place_of_birth),
            description: description.and_then(|s| if s.as_str() == "" { None } else { Some(s) }),
            source_url: Some(format!(
                "https://www.themoviedb.org/person/{}-{}",
                identifier, name
            )),
            gender: details.gender.and_then(|g| match g {
                1 => Some("Female".to_owned()),
                2 => Some("Male".to_owned()),
                3 => Some("Non-Binary".to_owned()),
                _ => None,
            }),
            assets: EntityAssets {
                remote_images: images,
                ..Default::default()
            },
            ..Default::default()
        };
        Ok(resp)
    }
}

impl NonMediaTmdbService {
    pub async fn find_by_external_id(
        &self,
        external_id: &str,
        external_source: &str,
    ) -> Result<String> {
        let details: TmdbFindByExternalSourceResponse = self
            .base
            .client
            .get(format!("{}/find/{}", URL, external_id))
            .query(&json!({ "language": self.base.language, "external_source": external_source }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json()
            .await
            .map_err(|e| anyhow!(e))?;
        if !details.movie_results.is_empty() {
            Ok(details.movie_results[0].id.to_string())
        } else if !details.tv_results.is_empty() {
            Ok(details.tv_results[0].id.to_string())
        } else {
            Err(anyhow!("No results found"))
        }
    }
}

pub struct TmdbMovieService {
    base: TmdbService,
}

impl TmdbMovieService {
    pub async fn new(ss: Arc<SupportingService>) -> Self {
        Self {
            base: TmdbService::new(ss).await,
        }
    }
}

#[async_trait]
impl MediaProvider for TmdbMovieService {
    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        display_nsfw: bool,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let page = page.unwrap_or(1);
        let rsp = self
            .base
            .client
            .get(format!("{}/search/movie", URL))
            .query(&json!({
                "query": query.to_owned(),
                "page": page,
                "language": self.base.language,
                "include_adult": display_nsfw,
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: TmdbListResponse = rsp.json().await.map_err(|e| anyhow!(e))?;

        let resp = search
            .results
            .into_iter()
            .map(|d| MetadataSearchItem {
                identifier: d.id.to_string(),
                title: d.title.unwrap(),
                publish_year: d.release_date.and_then(|r| convert_date_to_year(&r)),
                image: d.poster_path.map(|p| self.base.get_image_url(p)),
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

    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let rsp = self
            .base
            .client
            .get(format!("{}/movie/{}", URL, &identifier))
            .query(&json!({
                "language": self.base.language,
                "append_to_response": "videos",
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let data: TmdbMediaEntry = rsp.json().await.map_err(|e| anyhow!(e))?;
        let mut remote_videos = vec![];
        if let Some(vid) = data.videos {
            remote_videos.extend(vid.results.into_iter().map(|vid| EntityRemoteVideo {
                url: vid.key,
                source: EntityRemoteVideoSource::Youtube,
            }))
        }
        let rsp = self
            .base
            .client
            .get(format!("{}/movie/{}/credits", URL, identifier))
            .query(&json!({
                "language": self.base.language,
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let credits: TmdbCreditsResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        let mut people = vec![];
        people.extend(
            credits
                .cast
                .clone()
                .into_iter()
                .flat_map(|g| {
                    g.id.and_then(|id| {
                        g.known_for_department.map(|r| PartialMetadataPerson {
                            role: r,
                            character: g.character,
                            source: MediaSource::Tmdb,
                            identifier: id.to_string(),
                            name: g.name.unwrap_or_default(),
                            ..Default::default()
                        })
                    })
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
                    g.id.and_then(|id| {
                        g.known_for_department.map(|r| PartialMetadataPerson {
                            role: r,
                            character: g.character,
                            source: MediaSource::Tmdb,
                            identifier: id.to_string(),
                            name: g.name.unwrap_or_default(),
                            ..Default::default()
                        })
                    })
                })
                .unique()
                .collect_vec(),
        );
        people.extend(
            data.production_companies
                .unwrap_or_default()
                .into_iter()
                .map(|p| PartialMetadataPerson {
                    name: p.name,
                    source: MediaSource::Tmdb,
                    identifier: p.id.to_string(),
                    role: "Production Company".to_owned(),
                    source_specifics: Some(PersonSourceSpecifics {
                        is_tmdb_company: Some(true),
                        ..Default::default()
                    }),
                    ..Default::default()
                })
                .collect_vec(),
        );
        let mut image_ids = Vec::from_iter(data.poster_path.clone());
        if let Some(u) = data.backdrop_path {
            image_ids.push(u);
        }
        self.base
            .save_all_images("movie", identifier, &mut image_ids)
            .await?;
        let suggestions = self.base.get_all_suggestions("movie", identifier).await?;
        let watch_providers = self
            .base
            .get_all_watch_providers("movie", identifier)
            .await?;
        let external_identifiers = self
            .base
            .get_external_identifiers("movie", identifier)
            .await?;
        let title = data.title.clone().unwrap();

        let remote_images = image_ids
            .into_iter()
            .unique()
            .map(|p| self.base.get_image_url(p))
            .collect();

        Ok(MetadataDetails {
            people,
            suggestions,
            watch_providers,
            is_nsfw: data.adult,
            title: title.clone(),
            lot: MediaLot::Movie,
            source: MediaSource::Tmdb,
            description: data.overview,
            identifier: data.id.to_string(),
            production_status: data.status.clone(),
            external_identifiers: Some(external_identifiers),
            original_language: self.base.get_language_name(data.original_language.clone()),
            publish_date: data
                .release_date
                .clone()
                .and_then(|r| convert_string_to_date(&r)),
            genres: data
                .genres
                .unwrap_or_default()
                .into_iter()
                .map(|g| g.name)
                .collect(),
            assets: EntityAssets {
                remote_images,
                remote_videos,
                ..Default::default()
            },
            publish_year: data
                .release_date
                .as_ref()
                .and_then(|r| convert_date_to_year(r)),
            movie_specifics: Some(MovieSpecifics {
                runtime: data.runtime,
            }),
            source_url: Some(format!(
                "https://www.themoviedb.org/movie/{}-{}",
                data.id, title
            )),
            provider_rating: data
                .vote_average
                .filter(|&av| av != dec!(0))
                .map(|av| av * dec!(10)),
            groups: Vec::from_iter(data.belongs_to_collection)
                .into_iter()
                .map(|c| CommitMetadataGroupInput {
                    name: "Loading...".to_string(),
                    unique: UniqueMediaIdentifier {
                        lot: MediaLot::Movie,
                        source: MediaSource::Tmdb,
                        identifier: c.id.to_string(),
                    },
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        })
    }

    async fn metadata_group_search(
        &self,
        query: &str,
        page: Option<i32>,
        display_nsfw: bool,
    ) -> Result<SearchResults<MetadataGroupSearchItem>> {
        let page = page.unwrap_or(1);
        let rsp = self
            .base
            .client
            .get(format!("{}/search/collection", URL))
            .query(&json!({
                "query": query.to_owned(),
                "page": page,
                "language": self.base.language,
                "include_adult": display_nsfw,
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: TmdbListResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        let resp = search
            .results
            .into_iter()
            .map(|d| MetadataGroupSearchItem {
                name: d.title.unwrap(),
                identifier: d.id.to_string(),
                image: d.poster_path.map(|p| self.base.get_image_url(p)),
                ..Default::default()
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
            items: resp,
        })
    }

    async fn metadata_group_details(
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
            .base
            .client
            .get(format!("{}/collection/{}", URL, &identifier))
            .query(&json!({ "language": self.base.language }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json()
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
            .save_all_images("collection", identifier, &mut images)
            .await?;
        let parts = data
            .parts
            .into_iter()
            .map(|p| PartialMetadataWithoutId {
                lot: MediaLot::Movie,
                title: p.title.unwrap(),
                source: MediaSource::Tmdb,
                identifier: p.id.to_string(),
                image: p.poster_path.map(|p| self.base.get_image_url(p)),
                ..Default::default()
            })
            .collect_vec();
        let title = replace_from_end(data.name, " Collection", "");
        Ok((
            MetadataGroupWithoutId {
                lot: MediaLot::Movie,
                title: title.clone(),
                source: MediaSource::Tmdb,
                description: data.overview,
                identifier: identifier.to_owned(),
                parts: parts.len().try_into().unwrap(),
                source_url: Some(format!(
                    "https://www.themoviedb.org/collections/{}-{}",
                    identifier, title
                )),
                assets: EntityAssets {
                    remote_images: images,
                    ..Default::default()
                },
            },
            parts,
        ))
    }

    async fn get_trending_media(&self) -> Result<Vec<PartialMetadataWithoutId>> {
        self.base.get_trending_media("movie").await
    }
}

pub struct TmdbShowService {
    base: TmdbService,
}

impl TmdbShowService {
    pub async fn new(ss: Arc<SupportingService>) -> Self {
        Self {
            base: TmdbService::new(ss).await,
        }
    }
}

#[async_trait]
impl MediaProvider for TmdbShowService {
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let rsp = self
            .base
            .client
            .get(format!("{}/tv/{}", URL, &identifier))
            .query(&json!({
                "language": self.base.language,
                "append_to_response": "videos",
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let show_data: TmdbMediaEntry = rsp.json().await.map_err(|e| anyhow!(e))?;
        let mut remote_videos = vec![];
        if let Some(vid) = show_data.videos {
            remote_videos.extend(vid.results.into_iter().map(|vid| EntityRemoteVideo {
                url: vid.key,
                source: EntityRemoteVideoSource::Youtube,
            }))
        }
        let mut image_ids = Vec::from_iter(show_data.poster_path);
        if let Some(u) = show_data.backdrop_path {
            image_ids.push(u);
        }
        self.base
            .save_all_images("tv", identifier, &mut image_ids)
            .await?;
        let suggestions = self.base.get_all_suggestions("tv", identifier).await?;

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
            let rsp = self
                .base
                .client
                .get(format!(
                    "{}/tv/{}/season/{}",
                    URL,
                    identifier.to_owned(),
                    s.season_number
                ))
                .query(&json!({
                    "language": self.base.language,
                }))
                .send()
                .await
                .map_err(|e| anyhow!(e))?;
            let mut data: TmdbSeason = rsp.json().await.map_err(|e| anyhow!(e))?;
            let rsp = self
                .base
                .client
                .get(format!(
                    "{}/tv/{}/season/{}/credits",
                    URL,
                    identifier.to_owned(),
                    s.season_number
                ))
                .query(&json!({
                    "language": self.base.language,
                }))
                .send()
                .await
                .map_err(|e| anyhow!(e))?;
            #[derive(Debug, Serialize, Deserialize, Clone)]
            struct TmdbSeasonCredit {
                cast: Vec<TmdbCredit>,
            }
            let credits: TmdbSeasonCredit = rsp.json().await.map_err(|e| anyhow!(e))?;
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
                                g.id.and_then(|id| {
                                    g.known_for_department.map(|r| PartialMetadataPerson {
                                        role: r,
                                        character: g.character,
                                        source: MediaSource::Tmdb,
                                        identifier: id.to_string(),
                                        name: g.name.unwrap_or_default(),
                                        ..Default::default()
                                    })
                                })
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
                    name: p.name,
                    source: MediaSource::Tmdb,
                    identifier: p.id.to_string(),
                    role: "Production Company".to_owned(),
                    source_specifics: Some(PersonSourceSpecifics {
                        is_tmdb_company: Some(true),
                        ..Default::default()
                    }),
                    ..Default::default()
                })
                .collect_vec(),
        );
        let people: HashBag<PartialMetadataPerson> = HashBag::from_iter(people);
        let people = Vec::from_iter(people.set_iter())
            .into_iter()
            .sorted_by_key(|c| c.1)
            .rev()
            .map(|c| c.0)
            .cloned()
            .collect_vec();
        let seasons_without_specials = seasons
            .iter()
            .filter(|s| !SHOW_SPECIAL_SEASON_NAMES.contains(&s.name.as_str()))
            .collect_vec();
        let total_runtime = seasons_without_specials
            .iter()
            .flat_map(|s| s.episodes.iter())
            .map(|e| e.runtime.unwrap_or_default())
            .sum();
        let total_seasons = seasons_without_specials.len();
        let total_episodes = seasons_without_specials
            .iter()
            .flat_map(|s| s.episodes.iter())
            .count();
        let watch_providers = self.base.get_all_watch_providers("tv", identifier).await?;
        let external_identifiers = self.base.get_external_identifiers("tv", identifier).await?;
        let title = show_data.name.unwrap();

        let remote_images = image_ids
            .into_iter()
            .unique()
            .map(|p| self.base.get_image_url(p))
            .collect();

        Ok(MetadataDetails {
            people,
            suggestions,
            watch_providers,
            lot: MediaLot::Show,
            title: title.clone(),
            is_nsfw: show_data.adult,
            source: MediaSource::Tmdb,
            description: show_data.overview,
            production_status: show_data.status,
            identifier: show_data.id.to_string(),
            external_identifiers: Some(external_identifiers),
            original_language: self.base.get_language_name(show_data.original_language),
            publish_year: convert_date_to_year(
                &show_data.first_air_date.clone().unwrap_or_default(),
            ),
            publish_date: convert_string_to_date(
                &show_data.first_air_date.clone().unwrap_or_default(),
            ),
            source_url: Some(format!(
                "https://www.themoviedb.org/tv/{}-{}",
                show_data.id, title
            )),
            provider_rating: show_data
                .vote_average
                .filter(|&av| av != dec!(0))
                .map(|av| av * dec!(10)),
            genres: show_data
                .genres
                .unwrap_or_default()
                .into_iter()
                .map(|g| g.name)
                .unique()
                .collect(),
            assets: EntityAssets {
                remote_images,
                remote_videos,
                ..Default::default()
            },
            show_specifics: Some(ShowSpecifics {
                runtime: if total_runtime == 0 {
                    None
                } else {
                    Some(total_runtime)
                },
                total_seasons: if total_seasons == 0 {
                    None
                } else {
                    Some(total_seasons)
                },
                total_episodes: if total_episodes == 0 {
                    None
                } else {
                    Some(total_episodes)
                },
                seasons: seasons
                    .into_iter()
                    .map(|s| {
                        let poster_images =
                            Vec::from_iter(s.poster_path.map(|p| self.base.get_image_url(p)));
                        let backdrop_images =
                            Vec::from_iter(s.backdrop_path.map(|p| self.base.get_image_url(p)));
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
                                        e.still_path.map(|p| self.base.get_image_url(p)),
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
            ..Default::default()
        })
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        display_nsfw: bool,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let page = page.unwrap_or(1);
        let rsp = self
            .base
            .client
            .get(format!("{}/search/tv", URL))
            .query(&json!({
                "query": query.to_owned(),
                "page": page,
                "language": self.base.language,
                "include_adult": display_nsfw,
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: TmdbListResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        let resp = search
            .results
            .into_iter()
            .map(|d| MetadataSearchItem {
                identifier: d.id.to_string(),
                title: d.title.unwrap_or_default(),
                publish_year: convert_date_to_year(&d.first_air_date.unwrap()),
                image: d.poster_path.map(|p| self.base.get_image_url(p)),
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

    async fn get_trending_media(&self) -> Result<Vec<PartialMetadataWithoutId>> {
        self.base.get_trending_media("tv").await
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

async fn get_settings(client: &Client, ss: &Arc<SupportingService>) -> Result<TmdbSettings> {
    let cc = &ss.cache_service;
    let maybe_settings = cc
        .get_value::<TmdbSettings>(ApplicationCacheKey::TmdbSettings)
        .await;
    if let Some((_id, setting)) = maybe_settings {
        return Ok(setting);
    }
    #[derive(Debug, Serialize, Deserialize, Clone)]
    struct TmdbImageConfiguration {
        secure_base_url: String,
    }
    #[derive(Debug, Serialize, Deserialize, Clone)]
    struct TmdbConfiguration {
        images: TmdbImageConfiguration,
    }
    let rsp = client.get(format!("{}/configuration", URL)).send().await?;
    let data_1: TmdbConfiguration = rsp.json().await?;
    let rsp = client
        .get(format!("{}/configuration/languages", URL))
        .send()
        .await?;
    let data_2: Vec<TmdbLanguage> = rsp.json().await?;
    let settings = TmdbSettings {
        image_url: data_1.images.secure_base_url,
        languages: data_2,
    };
    cc.set_key(
        ApplicationCacheKey::TmdbSettings,
        ApplicationCacheValue::TmdbSettings(settings.clone()),
    )
    .await
    .ok();
    Ok(settings)
}
