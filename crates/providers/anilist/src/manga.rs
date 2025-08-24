use anyhow::Result;
use async_trait::async_trait;
use common_models::SearchDetails;
use common_utils::PAGE_SIZE;
use dependent_models::{MetadataSearchSourceSpecifics, SearchResults};
use media_models::MetadataDetails;
use media_models::MetadataSearchItem;
use traits::MediaProvider;

use crate::{
    base::AnilistService,
    models::{MediaType, media_details, search},
};

#[derive(Debug, Clone)]
pub struct AnilistMangaService {
    base: AnilistService,
}

impl AnilistMangaService {
    pub async fn new(config: &config_definition::AnilistConfig) -> Result<Self> {
        Ok(Self {
            base: AnilistService::new(config).await?,
        })
    }
}

#[async_trait]
impl MediaProvider for AnilistMangaService {
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let details =
            media_details(&self.base.client, identifier, &self.base.preferred_language).await?;
        Ok(details)
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let (items, total_items, next_page) = search(
            &self.base.client,
            MediaType::Manga,
            query,
            page,
            PAGE_SIZE,
            display_nsfw,
            &self.base.preferred_language,
        )
        .await?;
        Ok(SearchResults {
            items,
            details: SearchDetails {
                next_page,
                total_items,
            },
        })
    }
}
