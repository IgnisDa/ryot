use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use common_models::PersonSourceSpecifics;
use dependent_models::{PersonDetails, SearchResults};
use itertools::Itertools;
use media_models::PeopleSearchItem;
use supporting_service::SupportingService;
use traits::MediaProvider;

use crate::base::TvdbService;

pub struct NonMediaTvdbService {
    pub base: TvdbService,
}

impl NonMediaTvdbService {
    pub async fn new(ss: Arc<SupportingService>) -> Result<Self> {
        Ok(Self {
            base: TvdbService::new(ss).await?,
        })
    }
}

#[async_trait]
impl MediaProvider for NonMediaTvdbService {
    async fn people_search(
        &self,
        page: i32,
        query: &str,
        _display_nsfw: bool,
        source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let search_type = match source_specifics {
            Some(PersonSourceSpecifics {
                is_tvdb_company: Some(true),
                ..
            }) => "company",
            _ => "person",
        };

        let metadata_results = self.base.trigger_search(page, query, search_type).await?;

        let people_items = metadata_results
            .items
            .into_iter()
            .map(|item| PeopleSearchItem {
                name: item.title,
                image: item.image,
                identifier: item.identifier,
                ..Default::default()
            })
            .collect_vec();

        Ok(SearchResults {
            items: people_items,
            details: metadata_results.details,
        })
    }

    async fn person_details(
        &self,
        _identifier: &str,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
        todo!("Implement TVDB person details")
    }
}
