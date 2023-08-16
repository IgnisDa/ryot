use anyhow::{anyhow, Result};
use async_trait::async_trait;
use itertools::Itertools;
use serde::{Deserialize, Serialize};
use surf::{http::headers::USER_AGENT, Client};

use crate::{
    config::MusicBrainzConfig,
    migrator::MetadataLot,
    models::{
        media::{MediaDetails, MediaSearchItem},
        SearchResults,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::{convert_date_to_year, get_base_http_client, PAGE_LIMIT},
};

pub static URL: &str = "https://musicbrainz.org/ws/2/";
pub static IMAGES_URL: &str = "https://coverartarchive.org/";

#[derive(Debug, Clone)]
pub struct MusicBrainzService {
    client: Client,
}

impl MediaProviderLanguages for MusicBrainzService {
    fn supported_languages() -> Vec<String> {
        vec!["us".to_owned()]
    }

    fn default_language() -> String {
        "us".to_owned()
    }
}

impl MusicBrainzService {
    pub async fn new(config: &MusicBrainzConfig) -> Self {
        let mut headers = vec![];
        if let Some(ref u) = config.user_agent {
            headers.push((USER_AGENT, u.clone()));
        }
        let client = get_base_http_client(URL, headers);
        Self { client }
    }
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "kebab-case")]
struct ItemReleaseGroup {
    id: String,
    title: String,
    first_release_date: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "kebab-case")]
struct SearchResponse {
    count: i32,
    release_groups: Vec<ItemReleaseGroup>,
}

#[async_trait]
impl MediaProvider for MusicBrainzService {
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
            .get("release-group")
            .query(&serde_json::json!({
                "query": format!("release:{}", query),
                "limit": PAGE_LIMIT,
                "offset": (page - 1) * PAGE_LIMIT,
                "fmt": "json",
            }))
            .unwrap()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: SearchResponse = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let items = search
            .release_groups
            .into_iter()
            .map(|r| MediaSearchItem {
                image: Some(format!("{}/release-group/{}/front", IMAGES_URL, r.id)),
                identifier: r.id,
                lot: MetadataLot::Music,
                title: r.title,
                publish_year: r.first_release_date.and_then(|d| convert_date_to_year(&d)),
            })
            .collect_vec();
        let next_page = if search.count - ((page) * PAGE_LIMIT) > 0 {
            Some(page + 1)
        } else {
            None
        };
        Ok(SearchResults {
            total: search.count,
            items,
            next_page,
        })
    }
}
