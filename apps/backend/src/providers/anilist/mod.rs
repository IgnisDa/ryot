use anyhow::{anyhow, Result};
use async_trait::async_trait;
use graphql_client::{GraphQLQuery, Response};
use http_types::mime;
use itertools::Itertools;
use rust_decimal::Decimal;
use surf::{http::headers::ACCEPT, Client};

use crate::{
    config::{AnimeAnilistConfig, MangaAnilistConfig},
    entities::prelude::Person,
    migrator::{MetadataLot, MetadataSource},
    models::{
        media::{
            AnimeSpecifics, MangaSpecifics, MediaDetails, MediaSearchItem, MediaSpecifics,
            MetadataImageForMediaDetails, MetadataImageLot, MetadataVideo, MetadataVideoSource,
            PartialMetadata, PartialMetadataPerson,
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
    query_path = "src/providers/anilist/details.graphql",
    response_derives = "Debug",
    variables_derives = "Debug"
)]
struct DetailsQuery;

#[derive(Debug, Clone)]
pub struct AnilistService {
    client: Client,
    page_limit: i32,
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
pub struct AnilistAnimeService {
    base: AnilistService,
}

impl AnilistAnimeService {
    pub async fn new(_config: &AnimeAnilistConfig, page_limit: i32) -> Self {
        let client = get_client_config(URL).await;
        Self {
            base: AnilistService { client, page_limit },
        }
    }
}

#[async_trait]
impl MediaProvider for AnilistAnimeService {
    async fn person_details(&self, identity: PartialMetadataPerson) -> Result<Person> {
        todo!()
    }

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
            self.base.page_limit,
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
}

impl AnilistMangaService {
    pub async fn new(_config: &MangaAnilistConfig, page_limit: i32) -> Self {
        let client = get_client_config(URL).await;
        Self {
            base: AnilistService { client, page_limit },
        }
    }
}

#[async_trait]
impl MediaProvider for AnilistMangaService {
    async fn person_details(&self, identity: PartialMetadataPerson) -> Result<Person> {
        todo!()
    }

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
            self.base.page_limit,
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
    let mut images = Vec::from_iter(details.cover_image.map(|i| i.extra_large.unwrap()));
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
    let mut creators = Vec::from_iter(details.staff)
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
    creators.extend(
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
    let creators = creators.into_iter().unique().collect_vec();
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
            PartialMetadata {
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
        people: creators,
        creators: vec![],
        url_images: images,
        videos,
        genres: genres.into_iter().unique().collect(),
        publish_year: year,
        publish_date: None,
        specifics,
        suggestions,
        provider_rating: score,
        groups: vec![],
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
