use anyhow::Result;
use async_trait::async_trait;
use surf::Client;

use crate::{
    config::{AnimeMalConfig, MangaMalConfig},
    models::{
        media::{MediaDetails, MediaSearchItem},
        SearchDetails, SearchResults,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::get_base_http_client,
};

static URL: &str = "https://api.myanimelist.net/v2/";

#[derive(Debug, Clone)]
pub struct MalService {
    client: Client,
    page_limit: i32,
}

impl MediaProviderLanguages for MalService {
    fn supported_languages() -> Vec<String> {
        ["us"].into_iter().map(String::from).collect()
    }

    fn default_language() -> String {
        "us".to_owned()
    }
}

#[derive(Debug, Clone)]
pub struct MalAnimeService {
    base: MalService,
}

impl MalAnimeService {
    pub async fn new(config: &AnimeMalConfig, page_limit: i32) -> Self {
        let client = get_client_config(URL, &config.client_id).await;
        Self {
            base: MalService { client, page_limit },
        }
    }
}

#[async_trait]
impl MediaProvider for MalAnimeService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let details = details(&self.base.client, identifier).await?;
        Ok(details)
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
    ) -> Result<SearchResults<MediaSearchItem>> {
        let (items, total, next_page) = search(
            &self.base.client,
            "anime",
            query,
            page,
            self.base.page_limit,
        )
        .await?;
        Ok(SearchResults {
            details: SearchDetails { total, next_page },
            items,
        })
    }
}

#[derive(Debug, Clone)]
pub struct MalMangaService {
    base: MalService,
}

impl MalMangaService {
    pub async fn new(config: &MangaMalConfig, page_limit: i32) -> Self {
        let client = get_client_config(URL, &config.client_id).await;
        Self {
            base: MalService { client, page_limit },
        }
    }
}

#[async_trait]
impl MediaProvider for MalMangaService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let details = details(&self.base.client, identifier).await?;
        Ok(details)
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
    ) -> Result<SearchResults<MediaSearchItem>> {
        let (items, total, next_page) = search(
            &self.base.client,
            "manga",
            query,
            page,
            self.base.page_limit,
        )
        .await?;
        Ok(SearchResults {
            details: SearchDetails { total, next_page },
            items,
        })
    }
}

async fn get_client_config(url: &str, client_id: &str) -> Client {
    get_base_http_client(url, vec![("X-MAL-CLIENT-ID", client_id)])
}

async fn search(
    client: &Client,
    media_type: &str,
    query: &str,
    page: Option<i32>,
    page_limit: i32,
) -> Result<(Vec<MediaSearchItem>, i32, Option<i32>)> {
    todo!()
}

async fn details(client: &Client, id: &str) -> Result<MediaDetails> {
    todo!()
}
