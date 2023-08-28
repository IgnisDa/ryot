use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;
use surf::Client;

use crate::{
    config::{AnimeMalConfig, MangaMalConfig},
    models::{
        media::{MediaDetails, MediaSearchItem},
        SearchDetails, SearchResults,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::{convert_date_to_year, get_base_http_client},
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
    q: &str,
    page: Option<i32>,
    limit: i32,
) -> Result<(Vec<MediaSearchItem>, i32, Option<i32>)> {
    let page = page.unwrap_or(1);
    let offset = (page - 1) * limit;
    #[derive(Serialize, Deserialize, Debug)]
    struct SearchPaging {
        next: Option<String>,
    }
    #[derive(Serialize, Deserialize, Debug)]
    struct SearchImage {
        large: String,
    }
    #[derive(Serialize, Deserialize, Debug)]
    struct SearchNode {
        id: i128,
        title: String,
        start_date: Option<String>,
        main_picture: SearchImage,
    }
    #[derive(Serialize, Deserialize, Debug)]
    struct SearchData {
        node: SearchNode,
    }
    #[derive(Serialize, Deserialize, Debug)]
    struct SearchResponse {
        data: Vec<SearchData>,
        paging: SearchPaging,
    }
    let search: SearchResponse = client
        .get(media_type)
        .query(&json!({ "q": q, "limit": limit, "offset": offset, "fields": "start_date" }))
        .unwrap()
        .await
        .map_err(|e| anyhow!(e))?
        .body_json()
        .await
        .map_err(|e| anyhow!(e))?;
    let items = search
        .data
        .into_iter()
        .map(|d| MediaSearchItem {
            identifier: d.node.id.to_string(),
            title: d.node.title,
            publish_year: d.node.start_date.and_then(|d| convert_date_to_year(&d)),
            image: Some(d.node.main_picture.large),
        })
        .collect();
    Ok((items, 100, search.paging.next.map(|_| page + 1)))
}

async fn details(client: &Client, id: &str) -> Result<MediaDetails> {
    todo!()
}
