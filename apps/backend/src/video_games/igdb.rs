use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chrono::Datelike;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use serde_with::{formats::Flexible, serde_as, TimestampSeconds};

use crate::media::resolver::MediaDetails;
use crate::media::{MediaSpecifics, MetadataCreator, MetadataImage, MetadataImageUrl};
use crate::migrator::{MetadataImageLot, MetadataLot, VideoGameSource};
use crate::traits::MediaProvider;
use crate::utils::NamedObject;
use crate::{
    config::VideoGameConfig,
    media::{
        resolver::{MediaSearchItem, MediaSearchResults},
        PAGE_LIMIT,
    },
    utils::igdb,
};

use super::VideoGameSpecifics;

static FIELDS: &str = "
fields
    id,
    name,
    summary,
    cover.*, 
    first_release_date,
    involved_companies.company.name,
    involved_companies.company.logo.*,
    involved_companies.*,
    artworks.*,
    platforms.name,
    genres.*;
where version_parent = null; 
";

#[derive(Serialize, Deserialize, Debug)]
struct IgdbCompany {
    name: String,
    logo: Option<IgdbImage>,
}

#[derive(Serialize, Deserialize, Debug)]
struct IgdbInvolvedCompany {
    company: IgdbCompany,
    developer: bool,
    publisher: bool,
    porting: bool,
    supporting: bool,
}

#[derive(Serialize, Deserialize, Debug)]
struct IgdbImage {
    image_id: String,
    url: String,
}

#[serde_as]
#[derive(Serialize, Deserialize, Debug)]
struct IgdbSearchResponse {
    id: i32,
    name: String,
    summary: Option<String>,
    cover: Option<IgdbImage>,
    #[serde_as(as = "Option<TimestampSeconds<i64, Flexible>>")]
    first_release_date: Option<DateTimeUtc>,
    involved_companies: Option<Vec<IgdbInvolvedCompany>>,
    artworks: Option<Vec<IgdbImage>>,
    genres: Option<Vec<NamedObject>>,
    platforms: Option<Vec<NamedObject>>,
}

#[derive(Debug, Clone)]
pub struct IgdbService {
    image_url: String,
    image_size: String,
    config: VideoGameConfig,
}

impl IgdbService {
    pub async fn new(config: &VideoGameConfig) -> Self {
        Self {
            image_url: config.igdb.image_url.to_owned(),
            image_size: config.igdb.image_size.to_string(),
            config: config.clone(),
        }
    }
}

#[async_trait]
impl MediaProvider for IgdbService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let client = igdb::get_client(&self.config).await;
        let req_body = format!(
            r#"
{field}
where id = {id};
            "#,
            field = FIELDS,
            id = identifier
        );
        let mut rsp = client
            .post("games")
            .body_string(req_body)
            .await
            .map_err(|e| anyhow!(e))?;

        let mut details: Vec<IgdbSearchResponse> = rsp.body_json().await.map_err(|e| anyhow!(e))?;
        let detail = details.pop().unwrap();
        let d = self.igdb_response_to_search_response(detail);
        Ok(d)
    }

    async fn search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let page = page.unwrap_or(1);
        let client = igdb::get_client(&self.config).await;
        let req_body = format!(
            r#"
{field}
search "{query}"; 
limit {limit};
offset: {offset};
            "#,
            field = FIELDS,
            limit = PAGE_LIMIT,
            offset = (page - 1) * PAGE_LIMIT
        );
        let mut rsp = client
            .post("games")
            .body_string(req_body)
            .await
            .map_err(|e| anyhow!(e))?;

        let search: Vec<IgdbSearchResponse> = rsp.body_json().await.map_err(|e| anyhow!(e))?;

        // let total = search.len() as i32;
        // FIXME: I have not yet found a way to get the total number of responses, so we will hardcode this
        let total = 100;

        let resp = search
            .into_iter()
            .map(|r| {
                let a = self.igdb_response_to_search_response(r);
                MediaSearchItem {
                    identifier: a.identifier,
                    lot: MetadataLot::VideoGame,
                    title: a.title,
                    images: a
                        .images
                        .into_iter()
                        .map(|i| match i.url {
                            MetadataImageUrl::S3(_u) => unreachable!(),
                            MetadataImageUrl::Url(u) => u,
                        })
                        .collect(),
                    publish_year: a.publish_year,
                }
            })
            .collect::<Vec<_>>();
        Ok(MediaSearchResults {
            total,
            items: resp,
            next_page: Some(page + 1),
        })
    }
}

impl IgdbService {
    fn igdb_response_to_search_response(&self, item: IgdbSearchResponse) -> MediaDetails {
        let mut images = Vec::from_iter(item.cover.map(|a| MetadataImage {
            url: MetadataImageUrl::Url(self.get_cover_image_url(a.image_id)),
            lot: MetadataImageLot::Poster,
        }));
        let additional_images =
            item.artworks
                .unwrap_or_default()
                .into_iter()
                .map(|a| MetadataImage {
                    url: MetadataImageUrl::Url(self.get_cover_image_url(a.image_id)),
                    lot: MetadataImageLot::Poster,
                });
        images.extend(additional_images);
        let creators = item
            .involved_companies
            .into_iter()
            .flatten()
            .map(|ic| {
                let role = if ic.developer {
                    "Development"
                } else if ic.publisher {
                    "Publishing"
                } else if ic.porting {
                    "Porting"
                } else if ic.supporting {
                    "Supporting"
                } else {
                    "Unknown"
                };
                MetadataCreator {
                    name: ic.company.name,
                    image_urls: Vec::from_iter(
                        ic.company
                            .logo
                            .map(|u| self.get_cover_image_url(u.image_id)),
                    ),
                    role: role.to_owned(),
                }
            })
            .collect();
        MediaDetails {
            identifier: item.id.to_string(),
            lot: MetadataLot::VideoGame,
            title: item.name,
            description: item.summary,
            creators,
            images,
            publish_date: item.first_release_date.map(|d| d.date_naive()),
            publish_year: item.first_release_date.map(|d| d.year()),
            genres: item
                .genres
                .unwrap_or_default()
                .into_iter()
                .map(|g| g.name)
                .collect(),
            specifics: MediaSpecifics::VideoGame(VideoGameSpecifics {
                source: VideoGameSource::Igdb,
                platforms: item
                    .platforms
                    .unwrap_or_default()
                    .into_iter()
                    .map(|p| p.name)
                    .collect(),
            }),
        }
    }

    fn get_cover_image_url(&self, hash: String) -> String {
        format!("{}{}/{}.jpg", self.image_url, self.image_size, hash)
    }
}
