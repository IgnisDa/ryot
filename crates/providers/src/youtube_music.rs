use anyhow::{anyhow, Result};
use async_trait::async_trait;
use common_models::SearchDetails;
use common_utils::TEMP_DIR;
use dependent_models::SearchResults;
use media_models::{MetadataDetails, MetadataSearchItem};
use rustypipe::{
    client::RustyPipe,
    param::{Language, LANGUAGES},
};
use traits::{MediaProvider, MediaProviderLanguages};

pub struct YoutubeMusicService {
    client: RustyPipe,
}

impl YoutubeMusicService {
    pub async fn new() -> Self {
        let client = RustyPipe::builder().storage_dir(TEMP_DIR).build().unwrap();
        Self { client }
    }
}

impl MediaProviderLanguages for YoutubeMusicService {
    fn supported_languages() -> Vec<String> {
        LANGUAGES.iter().map(|l| l.name().to_owned()).collect()
    }

    fn default_language() -> String {
        Language::En.name().to_owned()
    }
}

#[async_trait]
impl MediaProvider for YoutubeMusicService {
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        todo!()
    }

    async fn metadata_search(
        &self,
        query: &str,
        _page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let results = self
            .client
            .query()
            .music_search_tracks(query)
            .await
            .map_err(|e| anyhow!(e))?;
        let data = SearchResults {
            details: SearchDetails {
                total: 1,
                next_page: None,
            },
            items: results
                .items
                .items
                .into_iter()
                .map(|i| MetadataSearchItem {
                    title: i.name,
                    identifier: i.id,
                    publish_year: None,
                    image: i.cover.last().map(|t| t.url.to_owned()),
                })
                .collect(),
        };
        Ok(data)
    }
}
