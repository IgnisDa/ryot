use anyhow::{anyhow, Result};
use async_trait::async_trait;
use graphql_client::{GraphQLQuery, Response};
use surf::Client;

use crate::{
    config::{AnimeAnilistConfig, MangaAnilistConfig},
    migrator::MetadataLot,
    miscellaneous::{
        resolver::{MediaDetails, MediaSearchItem, MediaSearchResults},
        PAGE_LIMIT,
    },
    traits::MediaProvider,
};

#[derive(Debug, Clone)]
pub struct AnilistAnimeService {
    client: Client,
}

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/providers/anilist_schema.json",
    query_path = "src/providers/anilist_query.graphql",
    response_derives = "Debug"
)]
struct SearchQuery;

impl AnilistAnimeService {
    pub async fn new(config: &AnimeAnilistConfig) -> Self {
        let client = utils::get_client_config(&config.url).await;
        Self { client }
    }
}

#[async_trait]
impl MediaProvider for AnilistAnimeService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        todo!()
    }

    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let (items, total, next_page) =
            utils::search(&self.client, search_query::MediaType::ANIME, query, page).await?;
        Ok(MediaSearchResults {
            total,
            next_page,
            items,
        })
    }
}

#[derive(Debug, Clone)]
pub struct AnilistMangaService {
    client: Client,
}

impl AnilistMangaService {
    pub async fn new(config: &MangaAnilistConfig) -> Self {
        let client = utils::get_client_config(&config.url).await;
        Self { client }
    }
}

#[async_trait]
impl MediaProvider for AnilistMangaService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        todo!()
    }

    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let page = page.unwrap_or(1);
        todo!()
    }
}

mod utils {
    use surf::{
        http::headers::{ACCEPT, USER_AGENT},
        Config, Url,
    };

    use crate::graphql::{AUTHOR, PROJECT_NAME};

    use super::*;

    pub async fn get_client_config(url: &str) -> Client {
        let client: Client = Config::new()
            .add_header(USER_AGENT, format!("{}/{}", AUTHOR, PROJECT_NAME))
            .unwrap()
            .add_header(ACCEPT, "application/json")
            .unwrap()
            .set_base_url(Url::parse(url).unwrap())
            .try_into()
            .unwrap();
        client
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
                lot: MetadataLot::Anime,
                title: b.title.unwrap().user_preferred.unwrap(),
                images: Vec::from_iter(b.banner_image),
                publish_year: b.season_year.map(|b| b.try_into().unwrap()),
            })
            .collect();
        Ok((media, total, next_page))
    }
}
