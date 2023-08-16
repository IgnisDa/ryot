use anyhow::{anyhow, Result};
use async_trait::async_trait;
use http_types::mime;
use itertools::Itertools;
use serde::{Deserialize, Serialize};
use surf::{http::headers::ACCEPT, Client};

use crate::{
    config::LastFmConfig,
    migrator::MetadataLot,
    models::{
        media::{MediaDetails, MediaSearchItem},
        SearchResults,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::{get_base_http_client, PAGE_LIMIT},
};

pub static URL: &str = "https://ws.audioscrobbler.com/2.0/";

#[derive(Debug, Clone)]
pub struct LastFmService {
    client: Client,
    api_key: String,
}

impl MediaProviderLanguages for LastFmService {
    fn supported_languages() -> Vec<String> {
        vec!["us".to_owned()]
    }

    fn default_language() -> String {
        "us".to_owned()
    }
}

impl LastFmService {
    pub async fn new(config: &LastFmConfig) -> Self {
        let client = get_base_http_client(URL, vec![(ACCEPT, mime::JSON)]);
        Self {
            client,
            api_key: config.api_key.clone(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemImage {
    #[serde(rename = "#text")]
    text: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct SearchItem {
    mbid: String,
    name: String,
    image: Vec<ItemImage>,
}

#[derive(Serialize, Deserialize, Debug)]
struct Trackmatches {
    track: Vec<SearchItem>,
}

#[derive(Serialize, Deserialize, Debug)]
struct OpenSearchData {
    #[serde(rename = "opensearch:totalResults")]
    count: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct SearchResponseInner {
    #[serde(flatten)]
    opensearch: OpenSearchData,
    trackmatches: Trackmatches,
}

#[derive(Serialize, Deserialize, Debug)]
struct SearchResponse {
    results: SearchResponseInner,
}

#[async_trait]
impl MediaProvider for LastFmService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        todo!();
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
    ) -> Result<SearchResults<MediaSearchItem>> {
        let page = page.unwrap_or(1);
        let mut rsp = self
            .client
            .get("")
            .query(&serde_json::json!({
                "api_key": self.api_key,
                "method": "track.search",
                "track": query,
                "limit": PAGE_LIMIT,
                "page": page,
                "format": "json",
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: SearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let items = search
            .results
            .trackmatches
            .track
            .into_iter()
            .map(|r| MediaSearchItem {
                image: r.image.into_iter().nth(1).map(|i| i.text),
                identifier: r.mbid,
                lot: MetadataLot::Music,
                title: r.name,
                publish_year: None,
            })
            .collect_vec();
        let next_page = if search.results.opensearch.count.parse::<i32>().unwrap()
            - ((page) * PAGE_LIMIT)
            > 0
        {
            Some(page + 1)
        } else {
            None
        };
        Ok(SearchResults {
            total: search.results.opensearch.count.parse::<i32>().unwrap(),
            items,
            next_page,
        })
    }
}
