use anyhow::Result;
use async_trait::async_trait;

use http_types::mime;
use surf::{http::headers::ACCEPT, Client};

use crate::{
    config::MangaMangaUpdatesConfig,
    models::{
        media::{MediaDetails, MediaSearchItem},
        SearchResults,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::get_base_http_client,
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

#[async_trait]
impl MediaProvider for MangaUpdatesService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        todo!()
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
    ) -> Result<SearchResults<MediaSearchItem>> {
        todo!()
    }
}
