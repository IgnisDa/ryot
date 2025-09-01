use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use common_models::PersonSourceSpecifics;
use dependent_models::{PersonDetails, SearchResults};
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
        _query: &str,
        _page: Option<i32>,
        _display_nsfw: bool,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        todo!("Implement TVDB people search")
    }

    async fn person_details(
        &self,
        _identifier: &str,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
        todo!("Implement TVDB person details")
    }
}
