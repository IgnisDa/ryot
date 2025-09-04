use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use common_models::{EntityAssets, PersonSourceSpecifics};
use dependent_models::{MetadataPersonRelated, PersonDetails, SearchResults};
use enum_models::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::PeopleSearchItem;
use supporting_service::SupportingService;
use traits::MediaProvider;

use crate::{base::TvdbService, models::*};

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
        identifier: &str,
        source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
        let person_type = match source_specifics {
            Some(PersonSourceSpecifics {
                is_tvdb_company: Some(true),
                ..
            }) => "company",
            _ => "person",
        };

        if person_type == "person" {
            let details: TvdbPersonExtendedResponse = self
                .base
                .client
                .get(format!("{URL}/people/{identifier}/extended"))
                .send()
                .await?
                .json()
                .await?;

            let person_data = details.data;
            let name = person_data.name.unwrap_or_default();

            let description = person_data
                .biographies
                .and_then(|biographies| biographies.first().map(|b| b.biography.clone()))
                .flatten();

            let gender = person_data.gender.and_then(|g| match g {
                1 => Some("Male".to_owned()),
                2 => Some("Female".to_owned()),
                3 => Some("Other".to_owned()),
                _ => None,
            });

            let mut related_metadata = vec![];
            if let Some(characters) = person_data.characters {
                for character in characters {
                    let character_name = character.name.clone().unwrap_or_default();
                    let role = character
                        .people_type
                        .clone()
                        .unwrap_or_else(|| "Actor".to_owned());

                    if let Some(movie_id) = character.movie_id {
                        let metadata = media_models::PartialMetadataWithoutId {
                            source: MediaSource::Tvdb,
                            identifier: movie_id.to_string(),
                            title: character_name.clone(),
                            image: character.image.clone(),
                            lot: enum_models::MediaLot::Movie,
                            ..Default::default()
                        };
                        related_metadata.push(MetadataPersonRelated {
                            metadata,
                            role: role.clone(),
                            character: Some(character_name.clone()),
                        });
                    }
                    if let Some(series_id) = character.series_id {
                        let metadata = media_models::PartialMetadataWithoutId {
                            lot: MediaLot::Show,
                            source: MediaSource::Tvdb,
                            title: character_name.clone(),
                            image: character.image.clone(),
                            identifier: series_id.to_string(),
                            ..Default::default()
                        };
                        related_metadata.push(MetadataPersonRelated {
                            role,
                            metadata,
                            character: Some(character_name),
                        });
                    }
                }
            }

            let mut images = vec![];
            if let Some(image_url) = person_data.image {
                images.push(image_url);
            }

            let source_url = person_data
                .slug
                .map(|slug| format!("https://www.thetvdb.com/people/{}", slug));

            let resp = PersonDetails {
                gender,
                source_url,
                description,
                related_metadata,
                name: name.clone(),
                birth_date: person_data.birth,
                death_date: person_data.death,
                place: person_data.birth_place,
                source_specifics: source_specifics.to_owned(),
                assets: EntityAssets {
                    remote_images: images,
                    ..Default::default()
                },
                ..Default::default()
            };
            Ok(resp)
        } else {
            let details: TvdbCompanyExtendedResponse = self
                .base
                .client
                .get(format!("{URL}/companies/{identifier}"))
                .send()
                .await?
                .json()
                .await?;

            let company_data = details.data;
            let name = company_data.name.unwrap_or_default();

            let description = company_data
                .country
                .as_ref()
                .map(|country| format!("Company from {}", country));

            let source_url = company_data
                .slug
                .map(|slug| format!("https://www.thetvdb.com/companies/{}", slug));

            let resp = PersonDetails {
                source_url,
                description,
                name: name.clone(),
                place: company_data.country,
                source_specifics: source_specifics.to_owned(),
                ..Default::default()
            };
            Ok(resp)
        }
    }
}
