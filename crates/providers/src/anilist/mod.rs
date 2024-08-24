use anyhow::{anyhow, Result};
use application_utils::get_base_http_client;
use async_trait::async_trait;
use chrono::NaiveDate;
use common_models::{SearchDetails, StoredUrl};
use config::AnilistPreferredLanguage;
use dependent_models::SearchResults;
use enums::{MediaLot, MediaSource};
use graphql_client::{GraphQLQuery, Response};
use itertools::Itertools;
use media_models::{
    AnimeAiringScheduleSpecifics, AnimeSpecifics, MangaSpecifics, MediaDetails,
    MetadataImageForMediaDetails, MetadataPerson, MetadataSearchItem, MetadataVideo,
    MetadataVideoSource, PartialMetadataPerson, PartialMetadataWithoutId, PeopleSearchItem,
    PersonSourceSpecifics,
};
use reqwest::Client;
use rust_decimal::Decimal;
use sea_orm::prelude::DateTimeUtc;
use traits::{MediaProvider, MediaProviderLanguages};

static URL: &str = "https://graphql.anilist.co";
static STUDIO_ROLE: &str = "Production Studio";

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/anilist/schema.json",
    query_path = "src/anilist/media_search.graphql",
    response_derives = "Debug,Clone",
    variables_derives = "Debug"
)]
struct MediaSearchQuery;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/anilist/schema.json",
    query_path = "src/anilist/staff_search.graphql",
    response_derives = "Debug,Clone",
    variables_derives = "Debug"
)]
struct StaffSearchQuery;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/anilist/schema.json",
    query_path = "src/anilist/studio_search.graphql",
    response_derives = "Debug,Clone",
    variables_derives = "Debug"
)]
struct StudioSearchQuery;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/anilist/schema.json",
    query_path = "src/anilist/media_details.graphql",
    response_derives = "Debug,Clone",
    variables_derives = "Debug"
)]
struct MediaDetailsQuery;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/anilist/schema.json",
    query_path = "src/anilist/staff_details.graphql",
    response_derives = "Debug,Clone",
    variables_derives = "Debug"
)]
struct StaffQuery;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/anilist/schema.json",
    query_path = "src/anilist/studio_details.graphql",
    response_derives = "Debug,Clone",
    variables_derives = "Debug"
)]
struct StudioQuery;

#[derive(Debug, Clone)]
pub struct AnilistService {
    client: Client,
    preferred_language: AnilistPreferredLanguage,
    page_size: i32,
}

impl MediaProviderLanguages for AnilistService {
    fn supported_languages() -> Vec<String> {
        ["us"].into_iter().map(String::from).collect()
    }

    fn default_language() -> String {
        "us".to_owned()
    }
}

impl AnilistService {
    async fn new(page_size: i32, config: &config::AnilistConfig) -> Self {
        let client = get_client_config().await;
        Self {
            client,
            page_size,
            preferred_language: config.preferred_language.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct NonMediaAnilistService {
    base: AnilistService,
}

impl NonMediaAnilistService {
    pub async fn new(config: &config::AnilistConfig, page_size: i32) -> Self {
        Self {
            base: AnilistService::new(page_size, config).await,
        }
    }
}

fn media_status_string(status: Option<media_details_query::MediaStatus>) -> Option<String> {
    match status {
        Some(media_details_query::MediaStatus::FINISHED) => Some("Finished".to_string()),
        Some(media_details_query::MediaStatus::RELEASING) => Some("Ongoing".to_string()),
        Some(media_details_query::MediaStatus::NOT_YET_RELEASED) => {
            Some("Not Yet Released".to_string())
        }
        Some(media_details_query::MediaStatus::CANCELLED) => Some("Canceled".to_string()),
        Some(media_details_query::MediaStatus::HIATUS) => Some("Hiatus".to_string()),
        _ => None,
    }
}

#[async_trait]
impl MediaProvider for NonMediaAnilistService {
    async fn people_search(
        &self,
        query: &str,
        page: Option<i32>,
        source_specifics: &Option<PersonSourceSpecifics>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let is_studio = matches!(
            source_specifics,
            Some(PersonSourceSpecifics {
                is_anilist_studio: Some(true),
                ..
            })
        );
        let (items, total, next_page) = if is_studio {
            let variables = studio_search_query::Variables {
                page: page.unwrap_or(1).into(),
                search: query.to_owned(),
                per_page: self.base.page_size.into(),
            };
            let body = StudioSearchQuery::build_query(variables);
            let search = self
                .base
                .client
                .post(URL)
                .json(&body)
                .send()
                .await
                .map_err(|e| anyhow!(e))?
                .json::<Response<studio_search_query::ResponseData>>()
                .await
                .map_err(|e| anyhow!(e))?
                .data
                .unwrap()
                .page
                .unwrap();
            let total = search.page_info.unwrap().total.unwrap().try_into().unwrap();
            let next_page = if total - (page.unwrap_or(1) * self.base.page_size) > 0 {
                Some(page.unwrap_or(1) + 1)
            } else {
                None
            };
            let items = search
                .studios
                .unwrap()
                .into_iter()
                .map(|s| {
                    let data = s.unwrap();
                    PeopleSearchItem {
                        identifier: data.id.to_string(),
                        name: data.name,
                        image: None,
                        birth_year: None,
                    }
                })
                .collect();
            (items, total, next_page)
        } else {
            let variables = staff_search_query::Variables {
                page: page.unwrap_or(1).into(),
                search: query.to_owned(),
                per_page: self.base.page_size.into(),
            };
            let body = StaffSearchQuery::build_query(variables);
            let search = self
                .base
                .client
                .post(URL)
                .json(&body)
                .send()
                .await
                .map_err(|e| anyhow!(e))?
                .json::<Response<staff_search_query::ResponseData>>()
                .await
                .map_err(|e| anyhow!(e))?
                .data
                .unwrap()
                .page
                .unwrap();
            let total = search.page_info.unwrap().total.unwrap().try_into().unwrap();
            let next_page = if total - (page.unwrap_or(1) * self.base.page_size) > 0 {
                Some(page.unwrap_or(1) + 1)
            } else {
                None
            };
            let items = search
                .staff
                .unwrap()
                .into_iter()
                .map(|s| {
                    let data = s.unwrap();
                    PeopleSearchItem {
                        identifier: data.id.to_string(),
                        name: data.name.unwrap().full.unwrap(),
                        image: data.image.and_then(|i| i.medium),
                        birth_year: data
                            .date_of_birth
                            .and_then(|b| b.year.map(|y| y.try_into().unwrap())),
                    }
                })
                .collect();
            (items, total, next_page)
        };
        Ok(SearchResults {
            details: SearchDetails { total, next_page },
            items,
        })
    }

    async fn person_details(
        &self,
        identity: &str,
        source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<MetadataPerson> {
        let is_studio = matches!(
            source_specifics,
            Some(PersonSourceSpecifics {
                is_anilist_studio: Some(true),
                ..
            })
        );
        let data = if is_studio {
            let variables = studio_query::Variables {
                id: identity.parse::<i64>().unwrap(),
            };
            let body = StudioQuery::build_query(variables);
            let details = self
                .base
                .client
                .post(URL)
                .json(&body)
                .send()
                .await
                .map_err(|e| anyhow!(e))?
                .json::<Response<studio_query::ResponseData>>()
                .await
                .map_err(|e| anyhow!(e))?
                .data
                .unwrap()
                .studio
                .unwrap();
            let related = details
                .media
                .unwrap()
                .edges
                .unwrap()
                .into_iter()
                .map(|r| {
                    let data = r.unwrap().node.unwrap();
                    (
                        STUDIO_ROLE.to_owned(),
                        PartialMetadataWithoutId {
                            title: data.title.unwrap().native.unwrap(),
                            identifier: data.id.to_string(),
                            source: MediaSource::Anilist,
                            lot: match data.type_.unwrap() {
                                studio_query::MediaType::ANIME => MediaLot::Anime,
                                studio_query::MediaType::MANGA => MediaLot::Manga,
                                studio_query::MediaType::Other(_) => unreachable!(),
                            },
                            image: data.cover_image.unwrap().extra_large,
                            is_recommendation: None,
                        },
                    )
                })
                .collect();
            MetadataPerson {
                identifier: details.id.to_string(),
                source: MediaSource::Anilist,
                name: details.name,
                related,
                source_specifics: source_specifics.to_owned(),
                website: details.site_url,
                description: None,
                gender: None,
                place: None,
                images: None,
                death_date: None,
                birth_date: None,
            }
        } else {
            let variables = staff_query::Variables {
                id: identity.parse::<i64>().unwrap(),
            };
            let body = StaffQuery::build_query(variables);
            let details = self
                .base
                .client
                .post(URL)
                .json(&body)
                .send()
                .await
                .map_err(|e| anyhow!(e))?
                .json::<Response<staff_query::ResponseData>>()
                .await
                .map_err(|e| anyhow!(e))?
                .data
                .unwrap()
                .staff
                .unwrap();
            let images = Vec::from_iter(details.image.and_then(|i| i.large));
            let birth_date = details.date_of_birth.and_then(|d| {
                if let (Some(y), Some(m), Some(d)) = (d.year, d.month, d.day) {
                    NaiveDate::from_ymd_opt(
                        y.try_into().unwrap(),
                        m.try_into().unwrap(),
                        d.try_into().unwrap(),
                    )
                } else {
                    None
                }
            });
            let death_date = details.date_of_death.and_then(|d| {
                if let (Some(y), Some(m), Some(d)) = (d.year, d.month, d.day) {
                    NaiveDate::from_ymd_opt(
                        y.try_into().unwrap(),
                        m.try_into().unwrap(),
                        d.try_into().unwrap(),
                    )
                } else {
                    None
                }
            });
            let mut related = details
                .character_media
                .unwrap()
                .edges
                .unwrap()
                .into_iter()
                .map(|r| {
                    let data = r.unwrap().node.unwrap();
                    let title = data.title.unwrap();
                    let title = get_in_preferred_language(
                        title.native,
                        title.english,
                        title.romaji,
                        &self.base.preferred_language,
                    );
                    (
                        "Voicing".to_owned(),
                        PartialMetadataWithoutId {
                            title,
                            identifier: data.id.to_string(),
                            source: MediaSource::Anilist,
                            lot: match data.type_.unwrap() {
                                staff_query::MediaType::ANIME => MediaLot::Anime,
                                staff_query::MediaType::MANGA => MediaLot::Manga,
                                staff_query::MediaType::Other(_) => unreachable!(),
                            },
                            image: data.cover_image.unwrap().extra_large,
                            is_recommendation: None,
                        },
                    )
                })
                .collect_vec();
            related.extend(
                details
                    .staff_media
                    .unwrap()
                    .edges
                    .unwrap()
                    .into_iter()
                    .map(|r| {
                        let data = r.unwrap().node.unwrap();
                        let title = data.title.unwrap();
                        let title = get_in_preferred_language(
                            title.native,
                            title.english,
                            title.romaji,
                            &self.base.preferred_language,
                        );
                        (
                            "Production".to_owned(),
                            PartialMetadataWithoutId {
                                title,
                                identifier: data.id.to_string(),
                                source: MediaSource::Anilist,
                                lot: match data.type_.unwrap() {
                                    staff_query::MediaType::ANIME => MediaLot::Anime,
                                    staff_query::MediaType::MANGA => MediaLot::Manga,
                                    staff_query::MediaType::Other(_) => unreachable!(),
                                },
                                image: data.cover_image.unwrap().extra_large,
                                is_recommendation: None,
                            },
                        )
                    }),
            );
            MetadataPerson {
                identifier: details.id.to_string(),
                source: MediaSource::Anilist,
                name: details.name.unwrap().full.unwrap(),
                description: details.description,
                gender: details.gender,
                place: details.home_town,
                images: Some(images),
                death_date,
                birth_date,
                related,
                source_specifics: source_specifics.to_owned(),
                website: None,
            }
        };
        Ok(data)
    }
}

#[derive(Debug, Clone)]
pub struct AnilistAnimeService {
    base: AnilistService,
}

impl AnilistAnimeService {
    pub async fn new(config: &config::AnilistConfig, page_size: i32) -> Self {
        Self {
            base: AnilistService::new(page_size, config).await,
        }
    }
}

#[async_trait]
impl MediaProvider for AnilistAnimeService {
    async fn metadata_details(&self, identifier: &str) -> Result<MediaDetails> {
        let details =
            media_details(&self.base.client, identifier, &self.base.preferred_language).await?;
        Ok(details)
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        display_nsfw: bool,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let (items, total, next_page) = search(
            &self.base.client,
            media_search_query::MediaType::ANIME,
            query,
            page,
            self.base.page_size,
            display_nsfw,
            &self.base.preferred_language,
        )
        .await?;
        Ok(SearchResults {
            details: SearchDetails { total, next_page },
            items,
        })
    }
}

#[derive(Debug, Clone)]
pub struct AnilistMangaService {
    base: AnilistService,
}

impl AnilistMangaService {
    pub async fn new(config: &config::AnilistConfig, page_size: i32) -> Self {
        Self {
            base: AnilistService::new(page_size, config).await,
        }
    }
}

#[async_trait]
impl MediaProvider for AnilistMangaService {
    async fn metadata_details(&self, identifier: &str) -> Result<MediaDetails> {
        let details =
            media_details(&self.base.client, identifier, &self.base.preferred_language).await?;
        Ok(details)
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        display_nsfw: bool,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let (items, total, next_page) = search(
            &self.base.client,
            media_search_query::MediaType::MANGA,
            query,
            page,
            self.base.page_size,
            display_nsfw,
            &self.base.preferred_language,
        )
        .await?;
        Ok(SearchResults {
            details: SearchDetails { total, next_page },
            items,
        })
    }
}

async fn get_client_config() -> Client {
    get_base_http_client(None)
}

async fn media_details(
    client: &Client,
    id: &str,
    preferred_language: &AnilistPreferredLanguage,
) -> Result<MediaDetails> {
    let variables = media_details_query::Variables {
        id: id.parse::<i64>().unwrap(),
    };
    let body = MediaDetailsQuery::build_query(variables);
    let details = client
        .post("")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!(e))?
        .json::<Response<media_details_query::ResponseData>>()
        .await
        .map_err(|e| anyhow!(e))?
        .data
        .unwrap()
        .media
        .unwrap();
    let mut images = Vec::from_iter(details.cover_image.and_then(|i| i.extra_large));
    if let Some(i) = details.banner_image {
        images.push(i);
    }
    let images = images
        .into_iter()
        .map(|i| MetadataImageForMediaDetails { image: i })
        .unique()
        .collect();
    let mut genres = details
        .genres
        .into_iter()
        .flatten()
        .map(|t| t.unwrap())
        .collect_vec();
    genres.extend(
        details
            .tags
            .unwrap_or_default()
            .into_iter()
            .flatten()
            .map(|t| t.name),
    );
    let mut people = Vec::from_iter(details.staff)
        .into_iter()
        .flat_map(|s| s.edges.unwrap())
        .flatten()
        .map(|s| {
            let node = s.node.unwrap();
            PartialMetadataPerson {
                name: node.name.unwrap().full.unwrap(),
                identifier: node.id.to_string(),
                source: MediaSource::Anilist,
                role: s.role.unwrap(),
                character: None,
                source_specifics: None,
            }
        })
        .collect_vec();
    people.extend(
        Vec::from_iter(details.studios)
            .into_iter()
            .flat_map(|s| s.edges.unwrap())
            .flatten()
            .map(|s| {
                let node = s.node.unwrap();
                PartialMetadataPerson {
                    name: node.name,
                    identifier: node.id.to_string(),
                    source: MediaSource::Anilist,
                    role: STUDIO_ROLE.to_owned(),
                    character: None,
                    source_specifics: Some(PersonSourceSpecifics {
                        is_anilist_studio: Some(true),
                        ..Default::default()
                    }),
                }
            }),
    );
    let people = people.into_iter().unique().collect_vec();
    let airing_schedule = details.airing_schedule.and_then(|a| a.nodes).map(|a| {
        a.into_iter()
            .flat_map(|s| {
                s.and_then(|data| {
                    DateTimeUtc::from_timestamp(data.airing_at, 0).map(|airing_at| {
                        AnimeAiringScheduleSpecifics {
                            episode: data.episode.try_into().unwrap(),
                            airing_at: airing_at.naive_utc(),
                        }
                    })
                })
            })
            .collect_vec()
    });
    let (lot, anime_specifics, manga_specifics) = match details.type_.unwrap() {
        media_details_query::MediaType::ANIME => (
            MediaLot::Anime,
            Some(AnimeSpecifics {
                episodes: details.episodes.and_then(|c| c.try_into().ok()),
                airing_schedule,
            }),
            None,
        ),
        media_details_query::MediaType::MANGA => (
            MediaLot::Manga,
            None,
            Some(MangaSpecifics {
                chapters: details.chapters.and_then(|c| c.try_into().ok()),
                volumes: details.volumes.and_then(|v| v.try_into().ok()),
                url: None,
            }),
        ),
        media_details_query::MediaType::Other(_) => unreachable!(),
    };

    let year = details
        .start_date
        .and_then(|b| b.year.map(|y| y.try_into().unwrap()));

    let suggestions = details
        .recommendations
        .unwrap()
        .nodes
        .unwrap()
        .into_iter()
        .flat_map(|r| {
            r.unwrap().media_recommendation.map(|data| {
                let title = data.title.unwrap();
                let title = get_in_preferred_language(
                    title.native,
                    title.english,
                    title.romaji,
                    preferred_language,
                );
                PartialMetadataWithoutId {
                    title,
                    identifier: data.id.to_string(),
                    source: MediaSource::Anilist,
                    lot: match data.type_.unwrap() {
                        media_details_query::MediaType::ANIME => MediaLot::Anime,
                        media_details_query::MediaType::MANGA => MediaLot::Manga,
                        media_details_query::MediaType::Other(_) => unreachable!(),
                    },
                    image: data.cover_image.unwrap().extra_large,
                    is_recommendation: None,
                }
            })
        })
        .collect();
    let score = details.average_score.map(Decimal::from);
    let videos = Vec::from_iter(details.trailer.map(|t| MetadataVideo {
        identifier: StoredUrl::Url(t.id.unwrap()),
        source: match t.site.unwrap().as_str() {
            "youtube" => MetadataVideoSource::Youtube,
            "dailymotion" => MetadataVideoSource::Dailymotion,
            _ => unreachable!(),
        },
    }));
    let title = details.title.unwrap();
    let title = get_in_preferred_language(
        title.native,
        title.english,
        title.romaji,
        preferred_language,
    );
    Ok(MediaDetails {
        title,
        identifier: details.id.to_string(),
        is_nsfw: details.is_adult,
        source: MediaSource::Anilist,
        description: details.description,
        lot,
        people,
        creators: vec![],
        url_images: images,
        videos,
        genres: genres.into_iter().unique().collect(),
        publish_year: year,
        publish_date: None,
        anime_specifics,
        manga_specifics,
        suggestions,
        provider_rating: score,
        group_identifiers: vec![],
        s3_images: vec![],
        production_status: media_status_string(details.status),
        original_language: None,
        ..Default::default()
    })
}

async fn search(
    client: &Client,
    media_type: media_search_query::MediaType,
    query: &str,
    page: Option<i32>,
    page_size: i32,
    _is_adult: bool,
    preferred_language: &AnilistPreferredLanguage,
) -> Result<(Vec<MetadataSearchItem>, i32, Option<i32>)> {
    let page = page.unwrap_or(1);
    let variables = media_search_query::Variables {
        page: page.into(),
        search: query.to_owned(),
        type_: media_type,
        per_page: page_size.into(),
    };
    let body = MediaSearchQuery::build_query(variables);
    let search = client
        .post("")
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!(e))?
        .json::<Response<media_search_query::ResponseData>>()
        .await
        .map_err(|e| anyhow!(e))?
        .data
        .unwrap()
        .page
        .unwrap();
    let total = search.page_info.unwrap().total.unwrap().try_into().unwrap();
    let next_page = if total - (page * page_size) > 0 {
        Some(page + 1)
    } else {
        None
    };
    let media = search
        .media
        .unwrap()
        .into_iter()
        .flatten()
        .map(|b| {
            let title = b.title.unwrap();
            let title = get_in_preferred_language(
                title.native,
                title.english,
                title.romaji,
                preferred_language,
            );
            MetadataSearchItem {
                identifier: b.id.to_string(),
                title,
                image: b.cover_image.and_then(|l| l.extra_large).or(b.banner_image),
                publish_year: b
                    .start_date
                    .and_then(|b| b.year.map(|y| y.try_into().unwrap())),
            }
        })
        .collect();
    Ok((media, total, next_page))
}

fn get_in_preferred_language(
    native: Option<String>,
    english: Option<String>,
    romaji: Option<String>,
    preferred_language: &AnilistPreferredLanguage,
) -> String {
    let title = match preferred_language {
        AnilistPreferredLanguage::Native => native.clone(),
        AnilistPreferredLanguage::English => english.clone(),
        AnilistPreferredLanguage::Romaji => romaji.clone(),
    };
    title.or(native).or(english).or(romaji).unwrap()
}
