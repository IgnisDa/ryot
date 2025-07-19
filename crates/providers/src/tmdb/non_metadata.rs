use std::sync::Arc;

use anyhow::{Result, anyhow};
use async_trait::async_trait;
use common_models::{EntityAssets, PersonSourceSpecifics, SearchDetails};
use dependent_models::{MetadataPersonRelated, PersonDetails, SearchResults};
use enum_models::MediaSource;
use futures::stream::{self, StreamExt};
use futures::try_join;
use itertools::Itertools;
use media_models::PeopleSearchItem;
use serde_json::json;
use supporting_service::SupportingService;
use traits::MediaProvider;

use crate::tmdb::base::TmdbService;
use crate::tmdb::models::*;

pub struct NonMediaTmdbService {
    pub base: TmdbService,
}

impl NonMediaTmdbService {
    pub async fn new(ss: Arc<SupportingService>) -> Self {
        Self {
            base: TmdbService::new(ss).await,
        }
    }
}

#[async_trait]
impl MediaProvider for NonMediaTmdbService {
    async fn people_search(
        &self,
        query: &str,
        page: Option<i32>,
        display_nsfw: bool,
        source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let language = &self.base.language;
        let person_type = match source_specifics {
            Some(PersonSourceSpecifics {
                is_tmdb_company: Some(true),
                ..
            }) => "company",
            _ => "person",
        };
        let page = page.unwrap_or(1);
        let rsp = self
            .base
            .client
            .get(format!("{}/search/{}", URL, person_type))
            .query(&json!({
                "page": page,
                "language": language,
                "query": query.to_owned(),
                "include_adult": display_nsfw,
            }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?;
        let search: TmdbListResponse = rsp.json().await.map_err(|e| anyhow!(e))?;
        let resp = search
            .results
            .into_iter()
            .map(|d| PeopleSearchItem {
                name: d.title.unwrap(),
                identifier: d.id.to_string(),
                image: d.poster_path.map(|p| self.base.get_image_url(p)),
                ..Default::default()
            })
            .collect_vec();
        let next_page = (page < search.total_pages).then(|| page + 1);
        Ok(SearchResults {
            details: SearchDetails {
                total: search.total_results,
                next_page,
            },
            items: resp.to_vec(),
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
            .base
            .client
            .get(format!("{}/{}/{}", URL, person_type, identifier))
            .query(&json!({ "language": self.base.language }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json()
            .await
            .map_err(|e| anyhow!(e))?;
        let mut images = vec![];
        let description = details.description.or(details.biography);
        let mut related_metadata = vec![];
        if person_type == "person" {
            let ((), cred_det) = try_join!(
                self.base
                    .save_all_images(person_type, identifier, &mut images),
                async {
                    let resp = self
                        .base
                        .client
                        .get(format!(
                            "{}/{}/{}/combined_credits",
                            URL, person_type, identifier
                        ))
                        .query(&json!({ "language": self.base.language }))
                        .send()
                        .await
                        .map_err(|e| anyhow!(e))?;
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
                    image: media.poster_path.map(|p| self.base.get_image_url(p)),
                    lot: match media.media_type.unwrap().as_ref() {
                        "movie" => enum_models::MediaLot::Movie,
                        "tv" => enum_models::MediaLot::Show,
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
                .map(|media_type| fetch_company_media_by_type(media_type, identifier, &self.base))
                .buffer_unordered(5)
                .collect::<Vec<_>>()
                .await;

            for company_result in company_results {
                related_metadata.extend(company_result?);
            }

            self.base
                .save_all_images(person_type, identifier, &mut images)
                .await?;
        }

        let images = images
            .into_iter()
            .unique()
            .map(|p| self.base.get_image_url(p))
            .collect();

        let name = details.name;
        let resp = PersonDetails {
            related_metadata,
            name: name.clone(),
            source: MediaSource::Tmdb,
            website: details.homepage,
            birth_date: details.birthday,
            death_date: details.deathday,
            identifier: details.id.to_string(),
            source_specifics: source_specifics.to_owned(),
            place: details.origin_country.or(details.place_of_birth),
            description: description.and_then(|s| if s.as_str() == "" { None } else { Some(s) }),
            source_url: Some(format!(
                "https://www.themoviedb.org/person/{}-{}",
                identifier, name
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
            .base
            .client
            .get(format!("{}/find/{}", URL, external_id))
            .query(&json!({ "language": self.base.language, "external_source": external_source }))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json()
            .await
            .map_err(|e| anyhow!(e))?;
        if !details.movie_results.is_empty() {
            Ok(details.movie_results[0].id.to_string())
        } else if !details.tv_results.is_empty() {
            Ok(details.tv_results[0].id.to_string())
        } else {
            Err(anyhow!("No results found"))
        }
    }
}
