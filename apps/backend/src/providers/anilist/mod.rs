use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chrono::NaiveDate;
use graphql_client::{GraphQLQuery, Response};
use http_types::mime;
use itertools::Itertools;
use rust_decimal::Decimal;
use surf::{http::headers::ACCEPT, Client};

use crate::{
    config::AnilistConfig,
    entities::partial_metadata::PartialMetadataWithoutId,
    migrator::{MetadataLot, MetadataSource},
    models::{
        media::{
            AnimeSpecifics, MangaSpecifics, MediaDetails, MediaSearchItem, MediaSpecifics,
            MetadataImageForMediaDetails, MetadataImageLot, MetadataPerson, MetadataVideo,
            MetadataVideoSource, PartialMetadataPerson,
        },
        SearchDetails, SearchResults, StoredUrl,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::get_base_http_client,
};

static URL: &str = "https://graphql.anilist.co";

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/providers/anilist/schema.json",
    query_path = "src/providers/anilist/search.graphql",
    response_derives = "Debug",
    variables_derives = "Debug"
)]
struct SearchQuery;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/providers/anilist/schema.json",
    query_path = "src/providers/anilist/media_details.graphql",
    response_derives = "Debug",
    variables_derives = "Debug"
)]
struct DetailsQuery;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/providers/anilist/schema.json",
    query_path = "src/providers/anilist/studio_details.graphql",
    response_derives = "Debug",
    variables_derives = "Debug"
)]
struct StudioQuery;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/providers/anilist/schema.json",
    query_path = "src/providers/anilist/staff_details.graphql",
    response_derives = "Debug",
    variables_derives = "Debug"
)]
struct StaffQuery;

#[derive(Debug, Clone)]
pub struct AnilistService {
    client: Client,
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
            base: AnilistService { client },
        }
    }
}

#[async_trait]
impl MediaProvider for NonMediaAnilistService {
    async fn person_details(&self, identity: &PartialMetadataPerson) -> Result<MetadataPerson> {
        person_details(&self.base.client, identity).await
    }
}

#[derive(Debug, Clone)]
pub struct AnilistAnimeService {
    base: AnilistService,
    page_limit: i32,
}

impl AnilistAnimeService {
    pub async fn new(_config: &AnilistConfig, page_limit: i32) -> Self {
        let client = get_client_config(URL).await;
        Self {
            base: AnilistService { client },
            page_limit,
        }
    }
}

#[async_trait]
impl MediaProvider for AnilistAnimeService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let details = details(&self.base.client, identifier).await?;
        Ok(details)
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
        display_nsfw: bool,
    ) -> Result<SearchResults<MediaSearchItem>> {
        let (items, total, next_page) = search(
            &self.base.client,
            search_query::MediaType::ANIME,
            query,
            page,
            self.page_limit,
            display_nsfw,
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
    pub async fn new(_config: &AnilistConfig, page_limit: i32) -> Self {
        let client = get_client_config(URL).await;
        Self {
            base: AnilistService { client },
            page_limit,
        }
    }
}

#[async_trait]
impl MediaProvider for AnilistMangaService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let details = details(&self.base.client, identifier).await?;
        Ok(details)
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
        display_nsfw: bool,
    ) -> Result<SearchResults<MediaSearchItem>> {
        let (items, total, next_page) = search(
            &self.base.client,
            search_query::MediaType::MANGA,
            query,
            page,
            self.page_limit,
            display_nsfw,
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
    identity: &PartialMetadataPerson,
) -> Result<MetadataPerson> {
    let data = if identity.role.as_str() == "Production" {
        let variables = studio_query::Variables {
            id: identity.identifier.parse::<i64>().unwrap(),
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
                PartialMetadataWithoutId {
                    title: data.title.unwrap().user_preferred.unwrap(),
                    identifier: data.id.to_string(),
                    source: MetadataSource::Anilist,
                    lot: match data.type_.unwrap() {
                        studio_query::MediaType::ANIME => MetadataLot::Anime,
                        studio_query::MediaType::MANGA => MetadataLot::Manga,
                        studio_query::MediaType::Other(_) => unreachable!(),
                    },
                    image: data.cover_image.unwrap().extra_large,
                }
            })
            .collect();
        MetadataPerson {
            identifier: details.id.to_string(),
            source: MetadataSource::Anilist,
            name: details.name,
            related,
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
            id: identity.identifier.parse::<i64>().unwrap(),
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
                PartialMetadataWithoutId {
                    title: data.title.unwrap().user_preferred.unwrap(),
                    identifier: data.id.to_string(),
                    source: MetadataSource::Anilist,
                    lot: match data.type_.unwrap() {
                        staff_query::MediaType::ANIME => MetadataLot::Anime,
                        staff_query::MediaType::MANGA => MetadataLot::Manga,
                        staff_query::MediaType::Other(_) => unreachable!(),
                    },
                    image: data.cover_image.unwrap().extra_large,
                }
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
                    PartialMetadataWithoutId {
                        title: data.title.unwrap().user_preferred.unwrap(),
                        identifier: data.id.to_string(),
                        source: MetadataSource::Anilist,
                        lot: match data.type_.unwrap() {
                            staff_query::MediaType::ANIME => MetadataLot::Anime,
                            staff_query::MediaType::MANGA => MetadataLot::Manga,
                            staff_query::MediaType::Other(_) => unreachable!(),
                        },
                        image: data.cover_image.unwrap().extra_large,
                    }
                }),
        );
        MetadataPerson {
            identifier: details.id.to_string(),
            source: MetadataSource::Anilist,
            name: details.name.unwrap().full.unwrap(),
            description: details.description,
            gender: details.gender,
            place: details.home_town,
            images: Some(images),
            death_date,
            birth_date,
            related,
            website: None,
        }
    };
    Ok(data)
}

async fn details(client: &Client, id: &str) -> Result<MediaDetails> {
    let variables = details_query::Variables {
        id: id.parse::<i64>().unwrap(),
    };
    let body = DetailsQuery::build_query(variables);
    let details = client
        .post("")
        .body_json(&body)
        .unwrap()
        .send()
        .await
        .map_err(|e| anyhow!(e))?
        .body_json::<Response<details_query::ResponseData>>()
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
                identifier: node.id.to_string(),
                source: MetadataSource::Anilist,
                role: s.role.unwrap(),
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
                    identifier: node.id.to_string(),
                    source: MetadataSource::Anilist,
                    role: "Production".to_owned(),
                }
            }),
    );
    let people = people.into_iter().unique().collect_vec();
    let (specifics, lot) = match details.type_.unwrap() {
        details_query::MediaType::ANIME => (
            MediaSpecifics::Anime(AnimeSpecifics {
                episodes: details.episodes.map(|c| c.try_into().unwrap()),
            }),
            MetadataLot::Anime,
        ),
        details_query::MediaType::MANGA => (
            MediaSpecifics::Manga(MangaSpecifics {
                chapters: details.chapters.map(|c| c.try_into().unwrap()),
                volumes: details.volumes.map(|v| v.try_into().unwrap()),
                url: None,
            }),
            MetadataLot::Manga,
        ),
        details_query::MediaType::Other(_) => unreachable!(),
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
        .map(|r| {
            let data = r.unwrap().media_recommendation.unwrap();
            PartialMetadataWithoutId {
                title: data.title.unwrap().user_preferred.unwrap(),
                identifier: data.id.to_string(),
                source: MetadataSource::Anilist,
                lot: match data.type_.unwrap() {
                    details_query::MediaType::ANIME => MetadataLot::Anime,
                    details_query::MediaType::MANGA => MetadataLot::Manga,
                    details_query::MediaType::Other(_) => unreachable!(),
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
    Ok(MediaDetails {
        identifier: details.id.to_string(),
        title: details.title.unwrap().user_preferred.unwrap(),
        is_nsfw: details.is_adult,
        production_status: "Released".to_owned(),
        source: MetadataSource::Anilist,
        description: details.description,
        lot,
        people,
        creators: vec![],
        url_images: images,
        videos,
        genres: genres.into_iter().unique().collect(),
        publish_year: year,
        publish_date: None,
        specifics,
        suggestions,
        provider_rating: score,
        group_identifiers: vec![],
        s3_images: vec![],
    })
}

async fn search(
    client: &Client,
    media_type: search_query::MediaType,
    query: &str,
    page: Option<i32>,
    page_limit: i32,
    _is_adult: bool,
) -> Result<(Vec<MediaSearchItem>, i32, Option<i32>)> {
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
        .map(|b| MediaSearchItem {
            identifier: b.id.to_string(),
            title: b.title.unwrap().user_preferred.unwrap(),
            image: b.banner_image,
            publish_year: b
                .start_date
                .and_then(|b| b.year.map(|y| y.try_into().unwrap())),
        })
        .collect();
    Ok((media, total, next_page))
}
