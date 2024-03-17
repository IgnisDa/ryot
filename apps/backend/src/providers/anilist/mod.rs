use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chrono::NaiveDate;
use database::{MediaSource, MetadataLot};
use graphql_client::{GraphQLQuery, Response};
use http_types::mime;
use itertools::Itertools;
use rust_decimal::Decimal;
use surf::{http::headers::ACCEPT, Client};

use crate::{
    models::{
        media::{
            AnimeSpecifics, MangaSpecifics, MediaDetails, MetadataImageForMediaDetails,
            MetadataImageLot, MetadataPerson, MetadataSearchItem, MetadataVideo,
            MetadataVideoSource, PartialMetadataPerson, PartialMetadataWithoutId,
            PersonSourceSpecifics,
        },
        SearchDetails, SearchResults, StoredUrl,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::get_base_http_client,
};

static URL: &str = "https://graphql.anilist.co";
static STUDIO_ROLE: &str = "Production Studio";

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/providers/anilist/schema.json",
    query_path = "src/providers/anilist/media_search.graphql",
    response_derives = "Debug,Clone",
    variables_derives = "Debug"
)]
struct SearchQuery;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/providers/anilist/schema.json",
    query_path = "src/providers/anilist/media_details.graphql",
    response_derives = "Debug,Clone",
    variables_derives = "Debug"
)]
struct MediaDetailsQuery;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/providers/anilist/schema.json",
    query_path = "src/providers/anilist/staff_details.graphql",
    response_derives = "Debug,Clone",
    variables_derives = "Debug"
)]
struct StaffQuery;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/providers/anilist/schema.json",
    query_path = "src/providers/anilist/studio_details.graphql",
    response_derives = "Debug,Clone",
    variables_derives = "Debug"
)]
struct StudioQuery;

#[derive(Debug, Clone)]
pub struct AnilistService {
    client: Client,
    prefer_english: bool,
}

impl MediaProviderLanguages for AnilistService {
    fn supported_languages() -> Vec<String> {
        ["us"].into_iter().map(String::from).collect()
    }

    fn default_language() -> String {
        "us".to_owned()
    }
}

#[derive(Debug, Clone)]
pub struct NonMediaAnilistService {
    base: AnilistService,
}

impl NonMediaAnilistService {
    pub async fn new() -> Self {
        let client = get_client_config(URL).await;
        Self {
            base: AnilistService {
                client,
                prefer_english: false,
            },
        }
    }
}

#[async_trait]
impl MediaProvider for NonMediaAnilistService {
    async fn person_details(
        &self,
        identity: &str,
        source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<MetadataPerson> {
        person_details(&self.base.client, identity, source_specifics).await
    }
}

#[derive(Debug, Clone)]
pub struct AnilistAnimeService {
    base: AnilistService,
    page_limit: i32,
}

impl AnilistAnimeService {
    pub async fn new(config: &config::AnilistConfig, page_limit: i32) -> Self {
        let client = get_client_config(URL).await;
        Self {
            base: AnilistService {
                client,
                prefer_english: config.prefer_english,
            },
            page_limit,
        }
    }
}

#[async_trait]
impl MediaProvider for AnilistAnimeService {
    async fn metadata_details(&self, identifier: &str) -> Result<MediaDetails> {
        let details =
            media_details(&self.base.client, identifier, self.base.prefer_english).await?;
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
            search_query::MediaType::ANIME,
            query,
            page,
            self.page_limit,
            display_nsfw,
            self.base.prefer_english,
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
    page_limit: i32,
}

impl AnilistMangaService {
    pub async fn new(config: &config::AnilistConfig, page_limit: i32) -> Self {
        let client = get_client_config(URL).await;
        Self {
            base: AnilistService {
                client,
                prefer_english: config.prefer_english,
            },
            page_limit,
        }
    }
}

#[async_trait]
impl MediaProvider for AnilistMangaService {
    async fn metadata_details(&self, identifier: &str) -> Result<MediaDetails> {
        let details =
            media_details(&self.base.client, identifier, self.base.prefer_english).await?;
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
            search_query::MediaType::MANGA,
            query,
            page,
            self.page_limit,
            display_nsfw,
            self.base.prefer_english,
        )
        .await?;
        Ok(SearchResults {
            details: SearchDetails { total, next_page },
            items,
        })
    }
}

async fn get_client_config(url: &str) -> Client {
    get_base_http_client(url, vec![(ACCEPT, mime::JSON)])
}

async fn person_details(
    client: &Client,
    identity: &str,
    source_specifics: &Option<PersonSourceSpecifics>,
) -> Result<MetadataPerson> {
    let is_studio = matches!(
        source_specifics,
        Some(PersonSourceSpecifics::Anilist { is_studio: true })
    );
    let data = if is_studio {
        let variables = studio_query::Variables {
            id: identity.parse::<i64>().unwrap(),
        };
        let body = StudioQuery::build_query(variables);
        let details = client
            .post("")
            .body_json(&body)
            .unwrap()
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .body_json::<Response<studio_query::ResponseData>>()
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
                        title: data.title.unwrap().user_preferred.unwrap(),
                        identifier: data.id.to_string(),
                        source: MediaSource::Anilist,
                        lot: match data.type_.unwrap() {
                            studio_query::MediaType::ANIME => MetadataLot::Anime,
                            studio_query::MediaType::MANGA => MetadataLot::Manga,
                            studio_query::MediaType::Other(_) => unreachable!(),
                        },
                        image: data.cover_image.unwrap().extra_large,
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
            website: None,
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
        let details = client
            .post("")
            .body_json(&body)
            .unwrap()
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .body_json::<Response<staff_query::ResponseData>>()
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
                (
                    "Voicing".to_owned(),
                    PartialMetadataWithoutId {
                        title: data.title.unwrap().user_preferred.unwrap(),
                        identifier: data.id.to_string(),
                        source: MediaSource::Anilist,
                        lot: match data.type_.unwrap() {
                            staff_query::MediaType::ANIME => MetadataLot::Anime,
                            staff_query::MediaType::MANGA => MetadataLot::Manga,
                            staff_query::MediaType::Other(_) => unreachable!(),
                        },
                        image: data.cover_image.unwrap().extra_large,
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
                    (
                        "Production".to_owned(),
                        PartialMetadataWithoutId {
                            title: data.title.unwrap().user_preferred.unwrap(),
                            identifier: data.id.to_string(),
                            source: MediaSource::Anilist,
                            lot: match data.type_.unwrap() {
                                staff_query::MediaType::ANIME => MetadataLot::Anime,
                                staff_query::MediaType::MANGA => MetadataLot::Manga,
                                staff_query::MediaType::Other(_) => unreachable!(),
                            },
                            image: data.cover_image.unwrap().extra_large,
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

async fn media_details(client: &Client, id: &str, prefer_english: bool) -> Result<MediaDetails> {
    let variables = media_details_query::Variables {
        id: id.parse::<i64>().unwrap(),
    };
    let body = MediaDetailsQuery::build_query(variables);
    let details = client
        .post("")
        .body_json(&body)
        .unwrap()
        .send()
        .await
        .map_err(|e| anyhow!(e))?
        .body_json::<Response<media_details_query::ResponseData>>()
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
        .map(|i| MetadataImageForMediaDetails {
            image: i,
            lot: MetadataImageLot::Poster,
        })
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
                    source_specifics: Some(PersonSourceSpecifics::Anilist { is_studio: true }),
                }
            }),
    );
    let people = people.into_iter().unique().collect_vec();
    let lot = match details.type_.unwrap() {
        media_details_query::MediaType::ANIME => MetadataLot::Anime,
        media_details_query::MediaType::MANGA => MetadataLot::Manga,
        media_details_query::MediaType::Other(_) => unreachable!(),
    };

    let anime_specifics = details.episodes.map(|c| AnimeSpecifics {
        episodes: c.try_into().ok(),
    });
    let manga_specifics = details
        .chapters
        .zip(details.volumes)
        .map(|(c, v)| MangaSpecifics {
            chapters: c.try_into().ok(),
            volumes: v.try_into().ok(),
            url: None,
        });

    let year = details
        .start_date
        .and_then(|b| b.year.map(|y| y.try_into().unwrap()));

    let suggestions = details
        .recommendations
        .unwrap()
        .nodes
        .unwrap()
        .into_iter()
        .map(|r| {
            let data = r.unwrap().media_recommendation.unwrap();
            PartialMetadataWithoutId {
                title: data.title.unwrap().user_preferred.unwrap(),
                identifier: data.id.to_string(),
                source: MediaSource::Anilist,
                lot: match data.type_.unwrap() {
                    media_details_query::MediaType::ANIME => MetadataLot::Anime,
                    media_details_query::MediaType::MANGA => MetadataLot::Manga,
                    media_details_query::MediaType::Other(_) => unreachable!(),
                },
                image: data.cover_image.unwrap().extra_large,
            }
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
    let title = if prefer_english {
        title.english.or(title.user_preferred).unwrap()
    } else {
        title.user_preferred.unwrap()
    };
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
        production_status: None,
        original_language: None,
        ..Default::default()
    })
}

async fn search(
    client: &Client,
    media_type: search_query::MediaType,
    query: &str,
    page: Option<i32>,
    page_limit: i32,
    _is_adult: bool,
    prefer_english: bool,
) -> Result<(Vec<MetadataSearchItem>, i32, Option<i32>)> {
    let page = page.unwrap_or(1);
    let variables = search_query::Variables {
        page: page.into(),
        search: query.to_owned(),
        type_: media_type,
        per_page: page_limit.into(),
    };
    let body = SearchQuery::build_query(variables);
    let search = client
        .post("")
        .body_json(&body)
        .unwrap()
        .send()
        .await
        .map_err(|e| anyhow!(e))?
        .body_json::<Response<search_query::ResponseData>>()
        .await
        .map_err(|e| anyhow!(e))?
        .data
        .unwrap()
        .page
        .unwrap();
    let total = search.page_info.unwrap().total.unwrap().try_into().unwrap();
    let next_page = if total - (page * page_limit) > 0 {
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
            let title = if prefer_english {
                title.english.or(title.user_preferred).unwrap()
            } else {
                title.user_preferred.unwrap()
            };
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
