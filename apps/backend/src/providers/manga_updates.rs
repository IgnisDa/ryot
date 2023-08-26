use anyhow::{anyhow, Result};
use async_trait::async_trait;
use convert_case::{Case, Casing};
use http_types::mime;
use itertools::Itertools;
use serde::{Deserialize, Serialize};
use surf::{http::headers::ACCEPT, Client};

use crate::{
    config::MangaMangaUpdatesConfig,
    migrator::{MetadataImageLot, MetadataLot, MetadataSource},
    models::{
        media::{
            BookSpecifics, MediaDetails, MediaSearchItem, MediaSpecifics, MetadataCreator,
            MetadataImage,
        },
        SearchDetails, SearchResults, StoredUrl,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::{convert_date_to_year, get_base_http_client},
};

pub static URL: &str = "https://api.mangaupdates.com/v1/series/";

#[derive(Debug, Clone)]
pub struct MangaUpdatesService {
    client: Client,
    page_limit: i32,
}

impl MediaProviderLanguages for MangaUpdatesService {
    fn supported_languages() -> Vec<String> {
        vec!["us".to_owned()]
    }

    fn default_language() -> String {
        "us".to_owned()
    }
}

impl MangaUpdatesService {
    pub async fn new(_config: &MangaMangaUpdatesConfig, page_limit: i32) -> Self {
        let client = get_base_http_client(URL, vec![(ACCEPT, mime::JSON)]);
        Self { client, page_limit }
    }
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemUrl {
    original: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemImage {
    url: ItemUrl,
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemRecord {
    series_id: i128,
    year: Option<String>,
    image: ItemImage,
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemResponse {
    hit_title: String,
    record: ItemRecord,
}

#[derive(Serialize, Deserialize, Debug)]
struct SearchResponse {
    total_hits: i32,
    results: Vec<ItemResponse>,
}

#[async_trait]
impl MediaProvider for MangaUpdatesService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        todo!()
        // let mut rsp = self.client.get(identifier).await.map_err(|e| anyhow!(e))?;
        // let data: ItemResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        // let d = self.google_books_response_to_search_response(data.volume_info, data.id);
        // Ok(d)
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
    ) -> Result<SearchResults<MediaSearchItem>> {
        let page = page.unwrap_or(1);
        let mut rsp = self
            .client
            .post("search")
            .body_json(&serde_json::json!({
                "search": query,
                "perpage": self.page_limit,
                "page": page
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: SearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let items = search
            .results
            .into_iter()
            .map(|s| MediaSearchItem {
                identifier: s.record.series_id.to_string(),
                title: s.hit_title,
                image: s.record.image.url.original,
                publish_year: s.record.year.and_then(|y| convert_date_to_year(&y)),
            })
            .collect();
        let next_page = if search.total_hits - ((page) * self.page_limit) > 0 {
            Some(page + 1)
        } else {
            None
        };
        Ok(SearchResults {
            details: SearchDetails {
                total: search.total_hits,
                next_page,
            },
            items,
        })
    }
}
