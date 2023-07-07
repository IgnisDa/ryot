use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chrono::Datelike;
use itertools::Itertools;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use serde_with::{formats::Flexible, serde_as, TimestampSeconds};

use crate::{
    config::VideoGameConfig,
    migrator::{MetadataImageLot, MetadataLot, MetadataSource},
    miscellaneous::{MediaSpecifics, MetadataCreator, MetadataImage, MetadataImageUrl},
    models::media::{MediaDetails, MediaSearchItem, MediaSearchResults, VideoGameSpecifics},
    traits::{MediaProvider, MediaProviderLanguages},
    utils::{NamedObject, PAGE_LIMIT},
};

pub static URL: &str = "https://api.igdb.com/v4/";
pub static IMAGE_URL: &str = "https://images.igdb.com/igdb/image/upload/";
pub static AUTH_URL: &str = "https://id.twitch.tv/oauth2/token";

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

impl MediaProviderLanguages for IgdbService {
    fn supported_languages() -> Vec<String> {
        ["us"].into_iter().map(String::from).collect()
    }

    fn default_language() -> String {
        "us".to_owned()
    }
}

impl IgdbService {
    pub async fn new(config: &VideoGameConfig) -> Self {
        Self {
            image_url: IMAGE_URL.to_owned(),
            image_size: config.igdb.image_size.to_string(),
            config: config.clone(),
        }
    }
}

#[async_trait]
impl MediaProvider for IgdbService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let client = utils::get_client(&self.config).await;
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

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
    ) -> Result<MediaSearchResults<MediaSearchItem>> {
        let page = page.unwrap_or(1);
        let client = utils::get_client(&self.config).await;
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

        // DEV: API does not return total count
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
            .unique()
            .collect();
        MediaDetails {
            identifier: item.id.to_string(),
            lot: MetadataLot::VideoGame,
            source: MetadataSource::Igdb,
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
                .unique()
                .collect(),
            specifics: MediaSpecifics::VideoGame(VideoGameSpecifics {
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

mod utils {
    use std::{env, fs};

    use serde_json::json;
    use surf::{http::headers::AUTHORIZATION, Client, Url};

    use super::*;
    use crate::{
        config::VideoGameConfig,
        utils::{get_base_http_client_config, get_now_timestamp, read_file_to_json},
    };

    #[derive(Deserialize, Debug, Serialize)]
    struct Credentials {
        access_token: String,
        expires_at: u128,
    }

    async fn get_access_token(config: &VideoGameConfig) -> Credentials {
        let mut access_res = surf::post(AUTH_URL)
            .query(&json!({
                "client_id": config.twitch.client_id.to_owned(),
                "client_secret": config.twitch.client_secret.to_owned(),
                "grant_type": "client_credentials".to_owned(),
            }))
            .unwrap()
            .await
            .unwrap();
        #[derive(Deserialize, Serialize, Default, Debug)]
        struct AccessResponse {
            access_token: String,
            token_type: String,
            expires_in: u128,
        }
        let access = access_res
            .body_json::<AccessResponse>()
            .await
            .unwrap_or_default();
        let expires_at = get_now_timestamp() + (access.expires_in * 1000);
        let access_token = format!("{} {}", access.token_type, access.access_token);
        Credentials {
            access_token,
            expires_at,
        }
    }

    // Ideally, I want this to use a mutex to store the client and expiry time.
    // However for the time being we will read and write to a file.
    pub async fn get_client(config: &VideoGameConfig) -> Client {
        let path = env::temp_dir().join("igdb-credentials.json");
        let access_token =
            if let Some(mut credential_details) = read_file_to_json::<Credentials>(&path) {
                if credential_details.expires_at < get_now_timestamp() {
                    tracing::info!("Access token has expired, refreshing...");
                    credential_details = get_access_token(config).await;
                    fs::write(path, serde_json::to_string(&credential_details).unwrap()).ok();
                }
                credential_details.access_token
            } else {
                let creds = get_access_token(config).await;
                fs::write(path, serde_json::to_string(&creds).unwrap()).ok();
                creds.access_token
            };
        get_base_http_client_config()
            .add_header("Client-ID", config.twitch.client_id.to_owned())
            .unwrap()
            .add_header(AUTHORIZATION, access_token)
            .unwrap()
            .set_base_url(Url::parse(URL).unwrap())
            .try_into()
            .unwrap()
    }
}
