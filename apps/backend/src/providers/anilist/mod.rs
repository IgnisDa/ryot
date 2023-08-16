use anyhow::{anyhow, Result};
use async_trait::async_trait;
use graphql_client::{GraphQLQuery, Response};
use surf::Client;

use crate::{
    config::{AnimeAnilistConfig, MangaAnilistConfig},
    migrator::MetadataLot,
    models::media::{MediaDetails, MediaSearchItem},
    models::SearchResults,
    traits::{MediaProvider, MediaProviderLanguages},
    utils::PAGE_LIMIT,
};

static URL: &str = "https://graphql.anilist.co";

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/providers/anilist/schema.json",
    query_path = "src/providers/anilist/search.graphql",
    response_derives = "Debug"
)]
struct SearchQuery;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/providers/anilist/schema.json",
    query_path = "src/providers/anilist/details.graphql",
    response_derives = "Debug"
)]
struct DetailsQuery;

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
pub struct AnilistAnimeService {
    base: AnilistService,
}

impl AnilistAnimeService {
    pub async fn new(_config: &AnimeAnilistConfig) -> Self {
        let client = utils::get_client_config(URL).await;
        Self {
            base: AnilistService { client },
        }
    }
}

#[async_trait]
impl MediaProvider for AnilistAnimeService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let details = utils::details(&self.base.client, identifier).await?;
        Ok(details)
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
    ) -> Result<SearchResults<MediaSearchItem>> {
        let (items, total, next_page) = utils::search(
            &self.base.client,
            search_query::MediaType::ANIME,
            query,
            page,
        )
        .await?;
        Ok(SearchResults {
            total,
            next_page,
            items,
        })
    }
}

#[derive(Debug, Clone)]
pub struct AnilistMangaService {
    base: AnilistService,
}

impl AnilistMangaService {
    pub async fn new(_config: &MangaAnilistConfig) -> Self {
        let client = utils::get_client_config(URL).await;
        Self {
            base: AnilistService { client },
        }
    }
}

#[async_trait]
impl MediaProvider for AnilistMangaService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let details = utils::details(&self.base.client, identifier).await?;
        Ok(details)
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
    ) -> Result<SearchResults<MediaSearchItem>> {
        let (items, total, next_page) = utils::search(
            &self.base.client,
            search_query::MediaType::MANGA,
            query,
            page,
        )
        .await?;
        Ok(SearchResults {
            total,
            next_page,
            items,
        })
    }
}

mod utils {
    use super::*;

    use http_types::mime;
    use itertools::Itertools;
    use surf::http::headers::ACCEPT;

    use crate::{
        migrator::{MetadataImageLot, MetadataSource},
        models::media::{
            AnimeSpecifics, MangaSpecifics, MediaSpecifics, MetadataCreator, MetadataImage,
            MetadataImageUrl,
        },
        utils::get_base_http_client,
    };

    pub async fn get_client_config(url: &str) -> Client {
        get_base_http_client(url, vec![(ACCEPT, mime::JSON)])
    }

    pub async fn details(client: &Client, id: &str) -> Result<MediaDetails> {
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
            .map(|i| MetadataImage {
                url: MetadataImageUrl::Url(i),
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
        let creators = Vec::from_iter(details.staff)
            .into_iter()
            .flat_map(|s| s.edges.unwrap())
            .flatten()
            .map(|s| {
                let node = s.node.unwrap();
                MetadataCreator {
                    name: node.name.unwrap().full.unwrap(),
                    role: s.role.unwrap(),
                    image: node.image.unwrap().large,
                }
            })
            .unique()
            .collect_vec();
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
                }),
                MetadataLot::Manga,
            ),
            details_query::MediaType::Other(_) => unreachable!(),
        };

        let year = details
            .start_date
            .and_then(|b| b.year.map(|y| y.try_into().unwrap()));
        Ok(MediaDetails {
            identifier: details.id.to_string(),
            title: details.title.unwrap().user_preferred.unwrap(),
            production_status: "Released".to_owned(),
            source: MetadataSource::Anilist,
            description: details.description,
            lot,
            creators,
            images,
            genres: genres.into_iter().unique().collect(),
            publish_year: year,
            publish_date: None,
            specifics,
        })
    }

    pub async fn search(
        client: &Client,
        media_type: search_query::MediaType,
        query: &str,
        page: Option<i32>,
    ) -> Result<(Vec<MediaSearchItem>, i32, Option<i32>)> {
        let page = page.unwrap_or(1);
        let variables = search_query::Variables {
            page: page.into(),
            search: query.to_owned(),
            type_: media_type,
            per_page: PAGE_LIMIT.into(),
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
        let next_page = if total - (page * PAGE_LIMIT) > 0 {
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
}
