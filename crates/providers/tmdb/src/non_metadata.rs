use std::sync::Arc;

use anyhow::{Result, anyhow};
use async_trait::async_trait;
use common_models::{EntityAssets, PersonSourceSpecifics, SearchDetails};
use common_utils::compute_next_page;
use dependent_models::{MetadataPersonRelated, PersonDetails, SearchResults};
use enum_models::{MediaLot, MediaSource};
use futures::{
    stream::{self, StreamExt},
    try_join,
};
use itertools::Itertools;
use media_models::PeopleSearchItem;
use supporting_service::SupportingService;
use traits::MediaProvider;

use crate::{
    base::TmdbService,
    models::{
        TmdbCreditsResponse, TmdbFindByExternalSourceResponse, TmdbListResponse,
        TmdbNonMediaEntity, URL, fetch_company_media_by_type,
    },
};

pub struct NonMediaTmdbService(TmdbService);

impl NonMediaTmdbService {
    pub async fn new(ss: Arc<SupportingService>) -> Result<Self> {
        Ok(Self(TmdbService::new(ss).await?))
    }
}

#[async_trait]
impl MediaProvider for NonMediaTmdbService {
    async fn people_search(
        &self,
        page: u64,
        query: &str,
        display_nsfw: bool,
        source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let language = &self.0.get_default_language();
        let person_type = match source_specifics {
            Some(PersonSourceSpecifics {
                is_tmdb_company: Some(true),
                ..
            }) => "company",
            _ => "person",
        };
        let rsp = self
            .0
            .client
            .get(format!("{URL}/search/{person_type}"))
            .query(&[
                ("language", language),
                ("page", &page.to_string()),
                ("query", &query.to_owned()),
                ("include_adult", &display_nsfw.to_string()),
            ])
            .send()
            .await?;
        let search: TmdbListResponse = rsp.json().await?;
        let items = search
            .results
            .into_iter()
            .map(|d| PeopleSearchItem {
                name: d.title.unwrap(),
                identifier: d.id.to_string(),
                image: d.poster_path.map(|p| self.0.get_image_url(p)),
                ..Default::default()
            })
            .collect_vec();
        let next_page = compute_next_page(page,search.total_results);
        Ok(SearchResults {
            items,
            details: SearchDetails {
                next_page,
                total_items: search.total_results,
            },
        })
    }

    async fn person_details(
        &self,
        identifier: &str,
        source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
        let person_type = match source_specifics {
            Some(PersonSourceSpecifics {
                is_tmdb_company: Some(true),
                ..
            }) => "company",
            _ => "person",
        };
        let details: TmdbNonMediaEntity = self
            .0
            .client
            .get(format!("{URL}/{person_type}/{identifier}"))
            .query(&[("language", &self.0.get_default_language())])
            .send()
            .await?
            .json()
            .await?;
        let mut images = vec![];
        let description = details.description.or(details.biography);
        let mut related_metadata = vec![];
        if person_type == "person" {
            let ((), cred_det) = try_join!(
                self.0.save_all_images(person_type, identifier, &mut images),
                async {
                    let resp = self
                        .0
                        .client
                        .get(format!("{URL}/{person_type}/{identifier}/combined_credits"))
                        .query(&[("language", &self.0.get_default_language())])
                        .send()
                        .await?;
                    resp.json::<TmdbCreditsResponse>()
                        .await
                        .map_err(|e| anyhow!(e))
                }
            )?;

            for media in cred_det.crew.into_iter().chain(cred_det.cast.into_iter()) {
                let role = media.job.unwrap_or_else(|| "Actor".to_owned());
                let metadata = media_models::PartialMetadataWithoutId {
                    source: MediaSource::Tmdb,
                    identifier: media.id.unwrap().to_string(),
                    title: media.title.or(media.name).unwrap_or_default(),
                    image: media.poster_path.map(|p| self.0.get_image_url(p)),
                    lot: match media.media_type.unwrap().as_ref() {
                        "tv" => MediaLot::Show,
                        "movie" => MediaLot::Movie,
                        _ => continue,
                    },
                    ..Default::default()
                };
                related_metadata.push(MetadataPersonRelated {
                    role,
                    metadata,
                    character: media.character,
                });
            }
        } else {
            let media_types = vec!["movie".to_string(), "tv".to_string()];
            let company_results = stream::iter(media_types)
                .map(|media_type| fetch_company_media_by_type(media_type, identifier, &self.0))
                .buffer_unordered(5)
                .collect::<Vec<_>>()
                .await;

            for company_result in company_results {
                related_metadata.extend(company_result?);
            }

            self.0
                .save_all_images(person_type, identifier, &mut images)
                .await?;
        }

        let images = images
            .into_iter()
            .unique()
            .map(|p| self.0.get_image_url(p))
            .collect();

        let name = details.name;
        let resp = PersonDetails {
            related_metadata,
            name: name.clone(),
            website: details.homepage,
            birth_date: details.birthday,
            death_date: details.deathday,
            source_specifics: source_specifics.to_owned(),
            description: description.filter(|s| !s.is_empty()),
            place: details.origin_country.or(details.place_of_birth),
            source_url: Some(format!(
                "https://www.themoviedb.org/{person_type}/{identifier}-{name}"
            )),
            gender: details.gender.and_then(|g| match g {
                1 => Some("Female".to_owned()),
                2 => Some("Male".to_owned()),
                3 => Some("Non-Binary".to_owned()),
                _ => None,
            }),
            assets: EntityAssets {
                remote_images: images,
                ..Default::default()
            },
            ..Default::default()
        };
        Ok(resp)
    }
}

impl NonMediaTmdbService {
    pub async fn find_by_external_id(
        &self,
        external_id: &str,
        external_source: &str,
    ) -> Result<String> {
        let details: TmdbFindByExternalSourceResponse = self
            .0
            .client
            .get(format!("{URL}/find/{external_id}"))
            .query(&[
                ("external_source", external_source),
                ("language", &self.0.get_default_language()),
            ])
            .send()
            .await?
            .json()
            .await?;
        if !details.movie_results.is_empty() {
            Ok(details.movie_results[0].id.to_string())
        } else if !details.tv_results.is_empty() {
            Ok(details.tv_results[0].id.to_string())
        } else {
            Err(anyhow!("No results found"))
        }
    }
}
