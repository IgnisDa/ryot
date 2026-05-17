use std::{collections::HashMap, sync::Arc};

use anyhow::{Result, anyhow};
use async_trait::async_trait;
use chrono::Datelike;
use common_models::{
    EntityAssets, EntityRemoteVideo, EntityRemoteVideoSource, IdAndNamedObject, IdObject,
    NamedObject, PersonSourceSpecifics, SearchDetails,
};
use common_utils::{PAGE_SIZE, compute_next_page, get_base_http_client};
use convert_case::{Case, Casing};
use database_models::metadata_group::MetadataGroupWithoutId;
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CoreDetailsProviderIgdbSpecifics,
    MetadataPersonRelated, MetadataSearchSourceIgdbFilterSpecifics, MetadataSearchSourceSpecifics,
    PersonDetails, SearchResults,
};
use enum_models::{MediaLot, MediaSource};
use futures::try_join;
use itertools::Itertools;
use media_models::{
    CommitMetadataGroupInput, MetadataDetails, MetadataGroupSearchItem, MetadataSearchItem,
    PartialMetadataPerson, PartialMetadataWithoutId, PeopleSearchItem, UniqueMediaIdentifier,
    VideoGameSpecifics, VideoGameSpecificsPlatformRelease, VideoGameSpecificsTimeToBeat,
};
use nest_struct::nest_struct;
use reqwest::{
    Client, Response,
    header::{AUTHORIZATION, HeaderName, HeaderValue},
};
use rust_decimal::Decimal;
use rust_iso3166::from_numeric;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_with::{TimestampSeconds, formats::Flexible, serde_as};
use slug::slugify;
use supporting_service::SupportingService;
use traits::MediaProvider;

static URL: &str = "https://api.igdb.com/v4";
static IMAGE_URL: &str = "https://images.igdb.com/igdb/image/upload";
static AUTH_URL: &str = "https://id.twitch.tv/oauth2/token";

static GAME_FIELDS: &str = "
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
    rating,
    similar_games.id,
    similar_games.name,
    similar_games.cover.*,
    collections.id,
    release_dates.date,
    release_dates.platform.name,
    release_dates.release_region.region,
    videos.*,
    genres.*;
";
static INVOLVED_COMPANY_FIELDS: &str = "
fields
    *,
    company.id,
    company.name,
    company.country,
    company.description,
    company.logo.*,
    company.websites.url,
    company.start_date,
    company.url,
    company.developed.id,
    company.developed.name,
    company.developed.cover.image_id,
    company.published.id,
    company.published.name,
    company.published.cover.image_id;
";
static COMPANY_FIELDS: &str = "
fields
    id,
    name,
    logo.*,
    start_date;
";
static COLLECTION_FIELDS: &str = "
fields
    id,
    name,
    games.id,
    games.name,
    games.cover.*,
    games.version_parent;
";
static GAME_TIME_TO_BEAT_FIELDS: &str = "
fields
    normally,
    hastily,
    completely;
";

#[derive(Serialize, Deserialize, Debug, Clone)]
struct IgdbWebsite {
    url: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct IgdbGameType {
    id: i32,
    #[serde(rename = "type")]
    typ: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct IgdbRegionResponse {
    id: i32,
    region: String,
}

#[serde_as]
#[derive(Serialize, Clone, Deserialize, Debug)]
struct IgdbCompany {
    country: Option<i32>,
    logo: Option<IgdbImage>,
    description: Option<String>,
    #[serde(flatten)]
    id_and_name: IdAndNamedObject,
    #[serde_as(as = "Option<TimestampSeconds<i64, Flexible>>")]
    start_date: Option<DateTimeUtc>,
    websites: Option<Vec<IgdbWebsite>>,
    developed: Option<Vec<IgdbItemResponse>>,
    published: Option<Vec<IgdbItemResponse>>,
}

#[derive(Serialize, Clone, Deserialize, Debug)]
struct IgdbVideo {
    video_id: String,
}

#[derive(Serialize, Clone, Deserialize, Debug)]
struct IgdbInvolvedCompany {
    id: i32,
    porting: bool,
    developer: bool,
    publisher: bool,
    supporting: bool,
    company: IgdbCompany,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct IgdbImage {
    image_id: String,
}

#[nest_struct]
#[serde_as]
#[derive(Serialize, Deserialize, Debug, Clone)]
struct IgdbReleaseDate {
    platform: NamedObject,
    #[serde_as(as = "Option<TimestampSeconds<i64, Flexible>>")]
    date: Option<DateTimeUtc>,
    release_region: Option<nest! { region: Option<String> }>,
}

#[serde_as]
#[derive(Serialize, Clone, Deserialize, Debug)]
struct IgdbItemResponse {
    id: i32,
    name: Option<String>,
    rating: Option<Decimal>,
    summary: Option<String>,
    cover: Option<IgdbImage>,
    version_parent: Option<i32>,
    videos: Option<Vec<IgdbVideo>>,
    genres: Option<Vec<NamedObject>>,
    artworks: Option<Vec<IgdbImage>>,
    collections: Option<Vec<IdObject>>,
    games: Option<Vec<IgdbItemResponse>>,
    #[serde_as(as = "Option<TimestampSeconds<i64, Flexible>>")]
    first_release_date: Option<DateTimeUtc>,
    release_dates: Option<Vec<IgdbReleaseDate>>,
    similar_games: Option<Vec<IgdbItemResponse>>,
    involved_companies: Option<Vec<IgdbInvolvedCompany>>,
    #[serde(flatten)]
    rest_data: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Clone)]
pub struct IgdbService {
    image_url: String,
    image_size: String,
    ss: Arc<SupportingService>,
}

impl IgdbService {
    pub async fn new(ss: Arc<SupportingService>) -> Result<Self> {
        let config = ss.config.video_games.clone();
        Ok(Self {
            ss,
            image_url: IMAGE_URL.to_owned(),
            image_size: config.igdb.image_size.to_string(),
        })
    }
}

fn extract_count_from_response(rsp: &Response) -> Result<u64> {
    rsp.headers()
        .get("x-count")
        .and_then(|h| h.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .ok_or_else(|| anyhow!("Failed to extract count from response headers"))
}

#[async_trait]
impl MediaProvider for IgdbService {
    #[allow(unused_variables)]
    async fn metadata_group_search(
        &self,
        page: u64,
        query: &str,
        display_nsfw: bool,
    ) -> Result<SearchResults<MetadataGroupSearchItem>> {
        let client = self.get_client_config().await?;
        let req_body = format!(
            r#"
{fields}
search "{query}";
limit {limit};
offset: {offset};
            "#,
            query = query,
            limit = PAGE_SIZE,
            fields = COLLECTION_FIELDS,
            offset = page.saturating_sub(1) * PAGE_SIZE
        );
        let rsp = client
            .post(format!("{URL}/collections"))
            .body(req_body)
            .send()
            .await?;
        let total_items = extract_count_from_response(&rsp)?;
        let details: Vec<IgdbItemResponse> = rsp.json().await?;
        let resp = details
            .into_iter()
            .map(|d| MetadataGroupSearchItem {
                name: d.name.unwrap(),
                identifier: d.id.to_string(),
                parts: d.games.map(|g| g.len()),
                image: d.cover.map(|c| self.get_cover_image_url(c.image_id)),
            })
            .collect_vec();
        let next_page = compute_next_page(page, total_items);
        Ok(SearchResults {
            items: resp.clone(),
            details: SearchDetails {
                next_page,
                total_items,
            },
        })
    }

    async fn metadata_group_details(
        &self,
        identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
        let client = self.get_client_config().await?;
        let req_body = format!(
            r"
{COLLECTION_FIELDS}
where id = {identifier};
            "
        );
        let details: IgdbItemResponse = client
            .post(format!("{URL}/collections"))
            .body(req_body)
            .send()
            .await?
            .json::<Vec<_>>()
            .await?
            .pop()
            .unwrap();
        let items = details
            .games
            .unwrap_or_default()
            .into_iter()
            .flat_map(|g| {
                if g.version_parent.is_some() {
                    None
                } else {
                    Some(PartialMetadataWithoutId {
                        title: g.name.unwrap(),
                        lot: MediaLot::VideoGame,
                        source: MediaSource::Igdb,
                        identifier: g.id.to_string(),
                        image: g.cover.map(|c| self.get_cover_image_url(c.image_id)),
                        ..Default::default()
                    })
                }
            })
            .collect_vec();
        let title = details.name.unwrap_or_default();
        Ok((
            MetadataGroupWithoutId {
                title: title.clone(),
                lot: MediaLot::VideoGame,
                source: MediaSource::Igdb,
                identifier: details.id.to_string(),
                parts: items.len().try_into().unwrap(),
                source_url: Some(format!(
                    "https://www.igdb.com/collection/{}",
                    slugify(title)
                )),
                ..Default::default()
            },
            items,
        ))
    }

    async fn people_search(
        &self,
        page: u64,
        query: &str,
        _display_nsfw: bool,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let client = self.get_client_config().await?;
        let req_body = format!(
            r#"
{fields}
search "{query}";
limit {limit};
offset: {offset};
            "#,
            query = query,
            limit = PAGE_SIZE,
            fields = COMPANY_FIELDS,
            offset = page.saturating_sub(1) * PAGE_SIZE
        );
        let rsp = client
            .post(format!("{URL}/companies"))
            .body(req_body)
            .send()
            .await?;
        let total_items = extract_count_from_response(&rsp)?;
        let details: Vec<IgdbCompany> = rsp.json().await?;
        let resp = details
            .into_iter()
            .map(|ic| {
                let image = ic.logo.map(|a| self.get_cover_image_url(a.image_id));
                PeopleSearchItem {
                    image,
                    name: ic.id_and_name.name,
                    identifier: ic.id_and_name.id.to_string(),
                    ..Default::default()
                }
            })
            .collect_vec();
        let next_page = compute_next_page(page, total_items);
        Ok(SearchResults {
            items: resp.clone(),
            details: SearchDetails {
                next_page,
                total_items,
            },
        })
    }

    async fn person_details(
        &self,
        identity: &str,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
        let client = self.get_client_config().await?;
        let req_body = format!(
            r#"
{INVOLVED_COMPANY_FIELDS}
where id = {identity};
            "#
        );
        let rsp = client
            .post(format!("{URL}/involved_companies"))
            .body(req_body)
            .send()
            .await?;
        let mut details: Vec<IgdbInvolvedCompany> = rsp.json().await?;
        let detail = details
            .pop()
            .map(|ic| ic.company)
            .ok_or_else(|| anyhow!("No data"))?;
        let mut related_metadata = detail
            .published
            .unwrap_or_default()
            .into_iter()
            .map(|r| {
                let image = r.cover.map(|a| self.get_cover_image_url(a.image_id));
                MetadataPersonRelated {
                    role: "Publishing".to_owned(),
                    metadata: PartialMetadataWithoutId {
                        image,
                        title: r.name.unwrap(),
                        lot: MediaLot::VideoGame,
                        source: MediaSource::Igdb,
                        identifier: r.id.to_string(),
                        ..Default::default()
                    },
                    ..Default::default()
                }
            })
            .collect_vec();
        related_metadata.extend(detail.developed.unwrap_or_default().into_iter().map(|r| {
            let image = r.cover.map(|a| self.get_cover_image_url(a.image_id));
            MetadataPersonRelated {
                role: "Development".to_owned(),
                metadata: PartialMetadataWithoutId {
                    image,
                    title: r.name.unwrap(),
                    lot: MediaLot::VideoGame,
                    source: MediaSource::Igdb,
                    identifier: r.id.to_string(),
                    ..Default::default()
                },
                ..Default::default()
            }
        }));
        let name = detail.id_and_name.name;
        Ok(PersonDetails {
            related_metadata,
            name: name.clone(),
            description: detail.description,
            source_url: Some(format!("https://www.igdb.com/companies/{}", slugify(name))),
            place: detail
                .country
                .and_then(from_numeric)
                .map(|c| c.name.to_owned()),
            website: detail
                .websites
                .unwrap_or_default()
                .first()
                .map(|i| i.url.clone()),
            assets: EntityAssets {
                remote_images: Vec::from_iter(
                    detail.logo.map(|l| self.get_cover_image_url(l.image_id)),
                ),
                ..Default::default()
            },
            ..Default::default()
        })
    }

    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let client = self.get_client_config().await?;
        let req_body = format!(r#"{GAME_FIELDS} where id = {identifier} & version_parent = null;"#);
        let ttb_req_body = format!(r#"{GAME_TIME_TO_BEAT_FIELDS} where game_id = {identifier};"#);

        let (details_rsp, ttb_rsp) = try_join!(
            client.post(format!("{URL}/games")).body(req_body).send(),
            client
                .post(format!("{URL}/game_time_to_beats"))
                .body(ttb_req_body)
                .send()
        )?;

        let (mut details, ttb_details) = try_join!(
            details_rsp.json::<Vec<IgdbItemResponse>>(),
            ttb_rsp.json::<Vec<VideoGameSpecificsTimeToBeat>>()
        )?;

        let detail = details.pop().ok_or_else(|| anyhow!("No details found"))?;

        let groups = match detail.collections.as_ref() {
            None => vec![],
            Some(cols) => cols
                .iter()
                .map(|c| CommitMetadataGroupInput {
                    name: "Loading...".to_string(),
                    unique: UniqueMediaIdentifier {
                        lot: MediaLot::VideoGame,
                        source: MediaSource::Igdb,
                        identifier: c.id.to_string(),
                    },
                    ..Default::default()
                })
                .collect(),
        };
        let mut game_details =
            self.igdb_response_to_search_response(detail, ttb_details.first().cloned());
        game_details.groups = groups;
        Ok(game_details)
    }

    async fn metadata_search(
        &self,
        page: u64,
        query: &str,
        _display_nsfw: bool,
        source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let client = self.get_client_config().await?;
        let search_filters = source_specifics
            .as_ref()
            .and_then(|s| s.igdb.as_ref())
            .and_then(|i| i.filters.clone());

        let allow_games_with_parent = search_filters
            .as_ref()
            .and_then(|i| i.allow_games_with_parent)
            .unwrap_or(false);

        let filter_builders: [(
            fn(&MetadataSearchSourceIgdbFilterSpecifics) -> Option<&Vec<String>>,
            &str,
        ); 6] = [
            (|f| f.theme_ids.as_ref(), "themes"),
            (|f| f.genre_ids.as_ref(), "genres"),
            (|f| f.platform_ids.as_ref(), "platforms"),
            (|f| f.game_type_ids.as_ref(), "game_type"),
            (|f| f.game_mode_ids.as_ref(), "game_modes"),
            (
                |f| f.release_date_region_ids.as_ref(),
                "release_dates.region",
            ),
        ];

        let mut filters = vec![];

        if !allow_games_with_parent {
            filters.push("version_parent = null".to_string());
        }

        let param_filters: Vec<String> = filter_builders
            .into_iter()
            .filter_map(|(getter, name)| {
                search_filters
                    .as_ref()
                    .and_then(getter)
                    .filter(|ids| !ids.is_empty())
                    .map(|ids| format!("{} = ({})", name, ids.join(",")))
            })
            .collect();

        filters.extend(param_filters);

        let where_clause = if filters.is_empty() {
            String::new()
        } else {
            format!("where {};", filters.join(" & "))
        };
        let req_body = format!(
            r#"
{fields}
{where_clause}
search "{query}";
limit {limit};
offset: {offset};
            "#,
            query = query,
            limit = PAGE_SIZE,
            fields = GAME_FIELDS.trim(),
            where_clause = where_clause,
            offset = page.saturating_sub(1) * PAGE_SIZE
        );

        let rsp = client
            .post(format!("{URL}/games"))
            .body(req_body)
            .send()
            .await?;

        let total_items = extract_count_from_response(&rsp)?;
        let search: Vec<IgdbItemResponse> = rsp.json().await?;

        let resp = search
            .into_iter()
            .map(|r| {
                let a = self.igdb_response_to_search_response(r.clone(), None);
                MetadataSearchItem {
                    title: a.title,
                    identifier: r.id.to_string(),
                    publish_year: a.publish_year,
                    image: a.assets.remote_images.first().cloned(),
                }
            })
            .collect_vec();

        let next_page = compute_next_page(page, total_items);
        Ok(SearchResults {
            items: resp,
            details: SearchDetails {
                next_page,
                total_items,
            },
        })
    }
}

impl IgdbService {
    fn get_cover_image_url(&self, hash: String) -> String {
        format!("{}/{}/{}.jpg", self.image_url, self.image_size, hash)
    }

    async fn get_access_token(&self) -> Result<String> {
        let client = Client::new();
        #[derive(Deserialize, Serialize, Default, Debug)]
        struct AccessResponse {
            expires_in: u128,
            token_type: String,
            access_token: String,
        }
        let access_res = client
            .post(AUTH_URL)
            .query(&[
                ("grant_type", "client_credentials"),
                ("client_id", &self.ss.config.video_games.twitch.client_id),
                (
                    "client_secret",
                    &self.ss.config.video_games.twitch.client_secret,
                ),
            ])
            .send()
            .await?;
        let access = access_res.json::<AccessResponse>().await?;
        Ok(format!("{} {}", access.token_type, access.access_token))
    }

    async fn get_client_config(&self) -> Result<Client> {
        let cached_response = cache_service::get_or_set_with_callback(
            &self.ss,
            ApplicationCacheKey::IgdbSettings,
            ApplicationCacheValue::IgdbSettings,
            || async { self.get_access_token().await },
        )
        .await?;
        let access_token = cached_response.response;
        Ok(get_base_http_client(Some(vec![
            (AUTHORIZATION, HeaderValue::from_str(&access_token).unwrap()),
            (
                HeaderName::from_static("client-id"),
                HeaderValue::from_str(&self.ss.config.video_games.twitch.client_id).unwrap(),
            ),
        ])))
    }

    fn igdb_response_to_search_response(
        &self,
        item: IgdbItemResponse,
        time_to_beat: Option<VideoGameSpecificsTimeToBeat>,
    ) -> MetadataDetails {
        let mut remote_images =
            Vec::from_iter(item.cover.map(|a| self.get_cover_image_url(a.image_id)));
        let additional_images = item
            .artworks
            .unwrap_or_default()
            .into_iter()
            .map(|a| self.get_cover_image_url(a.image_id));
        remote_images.extend(additional_images);

        let people = item
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
                PartialMetadataPerson {
                    role: role.to_owned(),
                    source: MediaSource::Igdb,
                    identifier: ic.id.to_string(),
                    name: ic.company.id_and_name.name,
                    ..Default::default()
                }
            })
            .unique()
            .collect();

        let remote_videos = item
            .videos
            .unwrap_or_default()
            .into_iter()
            .map(|vid| EntityRemoteVideo {
                url: vid.video_id,
                source: EntityRemoteVideoSource::Youtube,
            })
            .collect_vec();

        let title = item.name.unwrap();
        let platform_releases = item
            .release_dates
            .unwrap_or_default()
            .into_iter()
            .map(|rd| VideoGameSpecificsPlatformRelease {
                release_date: rd.date,
                name: rd.platform.name,
                release_region: rd
                    .release_region
                    .and_then(|r| r.region.map(|i| i.to_case(Case::Title))),
            })
            .sorted_by_key(|rd| rd.name.clone())
            .collect_vec();
        MetadataDetails {
            people,
            title: title.clone(),
            description: item.summary,
            provider_rating: item.rating,
            publish_year: item.first_release_date.map(|d| d.year()),
            publish_date: item.first_release_date.map(|d| d.date_naive()),
            source_url: Some(format!("https://www.igdb.com/games/{}", slugify(title))),
            assets: EntityAssets {
                remote_videos,
                remote_images,
                ..Default::default()
            },
            video_game_specifics: Some(VideoGameSpecifics {
                time_to_beat,
                platform_releases: match platform_releases.is_empty() {
                    true => None,
                    false => Some(platform_releases),
                },
            }),
            genres: item
                .genres
                .unwrap_or_default()
                .into_iter()
                .map(|g| g.name)
                .unique()
                .collect(),
            suggestions: item
                .similar_games
                .unwrap_or_default()
                .into_iter()
                .map(|g| PartialMetadataWithoutId {
                    title: g.name.unwrap(),
                    lot: MediaLot::VideoGame,
                    source: MediaSource::Igdb,
                    identifier: g.id.to_string(),
                    image: g.cover.map(|c| self.get_cover_image_url(c.image_id)),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        }
    }

    async fn paginate_igdb_endpoint<T>(
        &self,
        client: &Client,
        endpoint: &str,
        base_body: &str,
    ) -> Result<Vec<T>>
    where
        T: DeserializeOwned,
    {
        let limit = 500;
        let mut offset = 0;
        let mut items = vec![];

        loop {
            let body = if offset == 0 {
                base_body.to_string()
            } else {
                format!("{base_body} offset {offset};")
            };

            let rsp = client
                .post(format!("{URL}/{endpoint}"))
                .body(body)
                .send()
                .await?;

            let page_items = rsp.json::<Vec<T>>().await?;
            let page_size = page_items.len();
            items.extend(page_items);

            if page_size < limit {
                break;
            }

            offset += limit;
        }

        Ok(items)
    }

    async fn get_all_list_items(
        &self,
        endpoint: &str,
        client: &Client,
    ) -> Result<Vec<IdAndNamedObject>> {
        let base_body = "fields id, name; where name != null; limit 500;";
        let mut items = self
            .paginate_igdb_endpoint::<IdAndNamedObject>(client, endpoint, base_body)
            .await?;
        items.sort_by_key(|item| item.name.clone());
        Ok(items)
    }

    async fn get_game_types(&self, client: &Client) -> Result<Vec<IdAndNamedObject>> {
        let base_body = "fields id, type; limit 500;";
        let raw_items = self
            .paginate_igdb_endpoint::<IgdbGameType>(client, "game_types", base_body)
            .await?;

        let mut items: Vec<IdAndNamedObject> = raw_items
            .into_iter()
            .map(|item| IdAndNamedObject {
                id: item.id,
                name: item.typ,
            })
            .collect();

        items.sort_by_key(|item| item.name.clone());
        Ok(items)
    }

    async fn get_release_date_regions(&self, client: &Client) -> Result<Vec<IdAndNamedObject>> {
        let base_body = "fields id, region; limit 500;";
        let raw_items = self
            .paginate_igdb_endpoint::<IgdbRegionResponse>(client, "release_date_regions", base_body)
            .await?;

        let mut items: Vec<IdAndNamedObject> = raw_items
            .into_iter()
            .map(|item| IdAndNamedObject {
                id: item.id,
                name: item.region.to_case(Case::Title),
            })
            .collect();

        items.sort_by_key(|item| item.name.clone());
        Ok(items)
    }

    pub async fn get_provider_specifics(&self) -> Result<CoreDetailsProviderIgdbSpecifics> {
        let client = self.get_client_config().await?;
        let (themes, genres, platforms, game_modes, release_date_regions, game_types) = try_join!(
            self.get_all_list_items("themes", &client),
            self.get_all_list_items("genres", &client),
            self.get_all_list_items("platforms", &client),
            self.get_all_list_items("game_modes", &client),
            self.get_release_date_regions(&client),
            self.get_game_types(&client),
        )?;

        let response = CoreDetailsProviderIgdbSpecifics {
            themes,
            genres,
            platforms,
            game_modes,
            game_types,
            release_date_regions,
        };
        Ok(response)
    }
}
