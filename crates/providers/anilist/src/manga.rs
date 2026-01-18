use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use common_models::SearchDetails;
use common_utils::PAGE_SIZE;
use dependent_models::{MetadataSearchSourceSpecifics, SearchResults};
use dependent_translation_utils::persist_metadata_translation;
use enum_models::{EntityTranslationVariant, MediaLot, MediaSource};
use media_models::{MetadataDetails, MetadataSearchItem};
use supporting_service::SupportingService;
use traits::MediaProvider;

use crate::{
    base::AnilistService,
    models::{MediaType, media_details, search, translate_media},
};

#[derive(Clone)]
pub struct AnilistMangaService(AnilistService);

impl AnilistMangaService {
    pub async fn new(ss: Arc<SupportingService>) -> Result<Self> {
        Ok(Self(AnilistService::new(ss).await?))
    }
}

#[async_trait]
impl MediaProvider for AnilistMangaService {
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let details = media_details(&self.0.client, identifier).await?;
        Ok(details)
    }

    async fn metadata_search(
        &self,
        page: u64,
        query: &str,
        display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let (items, total_items, next_page) = search(
            &self.0.client,
            MediaType::Manga,
            query,
            page,
            PAGE_SIZE,
            display_nsfw,
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

    async fn translate_metadata(&self, identifier: &str, target_language: &str) -> Result<()> {
        let (title, description) =
            translate_media(&self.0.client, identifier, target_language).await?;
        persist_metadata_translation(
            identifier,
            MediaLot::Manga,
            MediaSource::Anilist,
            target_language,
            &[
                (EntityTranslationVariant::Title, title),
                (EntityTranslationVariant::Description, description),
            ],
            &self.0.ss,
        )
        .await?;
        Ok(())
    }
}
