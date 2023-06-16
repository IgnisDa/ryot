use anyhow::Result;
use async_trait::async_trait;
use graphql_client::GraphQLQuery;
use surf::Client;

use crate::{
    config::{AnimeAnilistConfig, MangaAnilistConfig},
    miscellaneous::resolver::{MediaDetails, MediaSearchResults},
    traits::MediaProvider,
};

#[derive(Debug, Clone)]
pub struct AnimeAnilistService {
    client: Client,
}

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/providers/anilist_schema.json",
    query_path = "src/providers/anilist_query.graphql",
    response_derives = "Debug"
)]
pub struct AnilistQuery;

impl AnimeAnilistService {
    pub async fn new(config: &AnimeAnilistConfig) -> Self {
        let client = utils::get_client_config(&config.url).await;
        Self { client }
    }
}

#[async_trait]
impl MediaProvider for AnimeAnilistService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        todo!()
    }

    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let page = page.unwrap_or(1);
        todo!()
    }
}

#[derive(Debug, Clone)]
pub struct MangaAnilistService {
    client: Client,
}

impl MangaAnilistService {
    pub async fn new(config: &MangaAnilistConfig) -> Self {
        let client = utils::get_client_config(&config.url).await;
        Self { client }
    }
}

#[async_trait]
impl MediaProvider for MangaAnilistService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        todo!()
    }

    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let page = page.unwrap_or(1);
        todo!()
    }
}

mod utils {
    use surf::{http::headers::USER_AGENT, Config, Url};

    use crate::graphql::{AUTHOR, PROJECT_NAME};

    use super::*;

    pub async fn get_client_config(url: &str) -> Client {
        let client: Client = Config::new()
            .add_header(USER_AGENT, format!("{}/{}", AUTHOR, PROJECT_NAME))
            .unwrap()
            .set_base_url(Url::parse(url).unwrap())
            .try_into()
            .unwrap();
        client
    }
}
