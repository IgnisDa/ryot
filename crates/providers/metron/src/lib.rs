use anyhow::Result;
use async_trait::async_trait;
use chrono::{Datelike, NaiveDate};
use common_models::{EntityAssets, PersonSourceSpecifics, SearchDetails};
use common_utils::{PAGE_SIZE, compute_next_page, get_base_http_client};
use database_models::metadata_group::MetadataGroupWithoutId;
use dependent_models::{MetadataSearchSourceSpecifics, PersonDetails, SearchResults};
use enum_models::{MediaLot, MediaSource};
use futures::{StreamExt, stream, try_join};
use itertools::Itertools;
use media_models::{
    ComicBookSpecifics, CommitMetadataGroupInput, MetadataDetails, MetadataGroupSearchItem,
    MetadataSearchItem, PartialMetadataPerson, PartialMetadataWithoutId, PeopleSearchItem,
    UniqueMediaIdentifier,
};
use reqwest::Client;
use serde::Deserialize;
use traits::MediaProvider;

static URL: &str = "https://metron.cloud/api";

#[derive(Debug, Clone)]
pub struct MetronService {
    client: Client,
    username: String,
    password: String,
}

impl MetronService {
    pub async fn new(config: &config_definition::MetronConfig) -> Result<Self> {
        let client = get_base_http_client(None);
        Ok(Self {
            client,
            username: config.username.clone(),
            password: config.password.clone(),
        })
    }
}

#[derive(Deserialize, Debug)]
struct PaginatedResponse<T> {
    count: u64,
    results: Vec<T>,
}

#[derive(Deserialize, Debug)]
struct IssueListSeries {
    name: String,
}

#[derive(Deserialize, Debug)]
struct IssueListItem {
    id: i64,
    image: Option<String>,
    number: Option<String>,
    series: IssueListSeries,
    cover_date: Option<String>,
}

#[derive(Deserialize, Debug)]
struct IssueCreditCreator {
    id: i64,
    name: String,
}

#[derive(Deserialize, Debug)]
#[serde(untagged)]
enum IssueCreditCreatorWrapper {
    String(String),
    Struct(IssueCreditCreator),
}

#[derive(Deserialize, Debug)]
struct IssueCreditRole {
    name: String,
}

#[derive(Deserialize, Debug)]
struct IssueCredit {
    role: Vec<IssueCreditRole>,
    creator: IssueCreditCreatorWrapper,
}

#[derive(Deserialize, Debug)]
struct IssueCharacter {
    id: i64,
    name: String,
}

#[derive(Deserialize, Debug)]
struct IssueArc {
    id: i64,
}

#[derive(Deserialize, Debug)]
struct IssueDetailSeries {
    id: i64,
    name: String,
}

#[derive(Deserialize, Debug)]
struct IssueDetail {
    id: i64,
    desc: Option<String>,
    image: Option<String>,
    number: Option<String>,
    page_count: Option<i32>,
    series: IssueDetailSeries,
    cover_date: Option<String>,
    arcs: Option<Vec<IssueArc>>,
    credits: Option<Vec<IssueCredit>>,
    characters: Option<Vec<IssueCharacter>>,
}

#[derive(Deserialize, Debug)]
struct SeriesListItem {
    id: i64,
    name: String,
    issue_count: Option<usize>,
}

#[derive(Deserialize, Debug)]
struct SeriesDetail {
    id: i64,
    name: String,
    desc: Option<String>,
    issue_count: Option<usize>,
}

#[derive(Deserialize, Debug)]
struct CreatorListItem {
    id: i64,
    name: String,
}

#[derive(Deserialize, Debug)]
struct CreatorDetail {
    name: String,
    desc: Option<String>,
    birth: Option<String>,
    death: Option<String>,
    image: Option<String>,
}

#[derive(Deserialize, Debug)]
struct ArcIssueListItem {
    id: i64,
    image: Option<String>,
    number: Option<String>,
    series: IssueListSeries,
    cover_date: Option<String>,
}

fn parse_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

fn issue_title(series_name: &str, number: &Option<String>) -> String {
    match number {
        None => series_name.to_owned(),
        Some(n) => format!("{} #{}", series_name, n),
    }
}

#[async_trait]
impl MediaProvider for MetronService {
    async fn metadata_search(
        &self,
        page: u64,
        query: &str,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let data: PaginatedResponse<IssueListItem> = self
            .client
            .get(format!("{URL}/issue/"))
            .basic_auth(&self.username, Some(&self.password))
            .query(&[
                ("page", page.to_string()),
                ("series_name", query.to_owned()),
                ("page_size", PAGE_SIZE.to_string()),
            ])
            .send()
            .await?
            .json()
            .await?;
        let items = data
            .results
            .into_iter()
            .map(|i| MetadataSearchItem {
                image: i.image,
                identifier: i.id.to_string(),
                title: issue_title(&i.series.name, &i.number),
                publish_year: i.cover_date.and_then(|d| parse_date(&d)).map(|d| d.year()),
            })
            .collect();
        Ok(SearchResults {
            items,
            details: SearchDetails {
                total_items: data.count,
                next_page: compute_next_page(page, data.count),
            },
        })
    }

    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let data: IssueDetail = self
            .client
            .get(format!("{URL}/issue/{identifier}/"))
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await?
            .json()
            .await?;

        let people =
            data.credits
                .unwrap_or_default()
                .into_iter()
                .flat_map(|credit| {
                    let roles = credit
                        .role
                        .into_iter()
                        .map(|r| r.name)
                        .collect_vec()
                        .join(", ");

                    let (name, identifier) = match credit.creator {
                        IssueCreditCreatorWrapper::Struct(c) => (c.name, c.id.to_string()),
                        IssueCreditCreatorWrapper::String(n) => (n.clone(), format!("name:{}", n)),
                    };

                    Some(PartialMetadataPerson {
                        name,
                        role: roles,
                        source: MediaSource::Metron,
                        identifier,
                        ..Default::default()
                    })
                })
                .chain(data.characters.unwrap_or_default().into_iter().map(|c| {
                    PartialMetadataPerson {
                        name: c.name,
                        source: MediaSource::Metron,
                        identifier: c.id.to_string(),
                        role: "Character".to_owned(),
                        ..Default::default()
                    }
                }))
                .collect_vec();

        let mut suggestions = vec![];
        if let Some(arcs) = &data.arcs {
            let arc_futures: Vec<_> = arcs
                .iter()
                .take(3)
                .map(|arc| {
                    let client = &self.client;
                    let username = &self.username;
                    let password = &self.password;
                    async move {
                        let arc_issues: PaginatedResponse<ArcIssueListItem> = client
                            .get(format!("{URL}/arc/{}/issue_list/", arc.id))
                            .basic_auth(username, Some(password))
                            .query(&[("page_size", PAGE_SIZE.to_string())])
                            .send()
                            .await?
                            .json()
                            .await?;
                        Ok::<_, anyhow::Error>(arc_issues)
                    }
                })
                .collect();

            let arc_issues_results = stream::iter(arc_futures)
                .buffer_unordered(5)
                .collect::<Vec<Result<PaginatedResponse<ArcIssueListItem>>>>()
                .await;

            for arc_issues_result in arc_issues_results {
                let arc_issues = arc_issues_result?;
                for issue in arc_issues.results {
                    if issue.id == data.id {
                        continue;
                    }
                    suggestions.push(PartialMetadataWithoutId {
                        image: issue.image,
                        lot: MediaLot::ComicBook,
                        source: MediaSource::Metron,
                        identifier: issue.id.to_string(),
                        title: issue_title(&issue.series.name, &issue.number),
                        publish_year: issue
                            .cover_date
                            .and_then(|d| parse_date(&d))
                            .map(|d| d.year()),
                    });
                }
            }
        }
        suggestions.dedup_by_key(|s| s.identifier.clone());

        let groups = vec![CommitMetadataGroupInput {
            name: data.series.name.clone(),
            unique: UniqueMediaIdentifier {
                lot: MediaLot::ComicBook,
                source: MediaSource::Metron,
                identifier: data.series.id.to_string(),
            },
            ..Default::default()
        }];

        Ok(MetadataDetails {
            people,
            groups,
            suggestions,
            description: data.desc,
            title: issue_title(&data.series.name, &data.number),
            publish_date: data.cover_date.as_ref().and_then(|d| parse_date(d)),
            source_url: Some(format!("https://metron.cloud/issue/{}", identifier)),
            assets: EntityAssets {
                remote_images: data.image.into_iter().collect(),
                ..Default::default()
            },
            publish_year: data
                .cover_date
                .as_ref()
                .and_then(|d| parse_date(d))
                .map(|d| d.year()),
            comic_book_specifics: Some(ComicBookSpecifics {
                issue_number: data.number,
                page_count: data.page_count,
                series_name: Some(data.series.name),
            }),
            ..Default::default()
        })
    }

    async fn people_search(
        &self,
        page: u64,
        query: &str,
        _display_nsfw: bool,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let data: PaginatedResponse<CreatorListItem> = self
            .client
            .get(format!("{URL}/creator/"))
            .basic_auth(&self.username, Some(&self.password))
            .query(&[
                ("name", query.to_owned()),
                ("page", page.to_string()),
                ("page_size", PAGE_SIZE.to_string()),
            ])
            .send()
            .await?
            .json()
            .await?;
        let items = data
            .results
            .into_iter()
            .map(|c| PeopleSearchItem {
                name: c.name,
                identifier: c.id.to_string(),
                ..Default::default()
            })
            .collect();
        Ok(SearchResults {
            items,
            details: SearchDetails {
                total_items: data.count,
                next_page: compute_next_page(page, data.count),
            },
        })
    }

    async fn person_details(
        &self,
        identifier: &str,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
        let data: CreatorDetail = self
            .client
            .get(format!("{URL}/creator/{identifier}/"))
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await?
            .json()
            .await?;
        Ok(PersonDetails {
            name: data.name,
            description: data.desc,
            birth_date: data.birth.and_then(|d| parse_date(&d)),
            death_date: data.death.and_then(|d| parse_date(&d)),
            source_url: Some(format!("https://metron.cloud/creator/{}", identifier)),
            assets: EntityAssets {
                remote_images: data.image.into_iter().collect(),
                ..Default::default()
            },
            ..Default::default()
        })
    }

    async fn metadata_group_search(
        &self,
        page: u64,
        query: &str,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataGroupSearchItem>> {
        let data: PaginatedResponse<SeriesListItem> = self
            .client
            .get(format!("{URL}/series/"))
            .basic_auth(&self.username, Some(&self.password))
            .query(&[
                ("name", query.to_owned()),
                ("page", page.to_string()),
                ("page_size", PAGE_SIZE.to_string()),
            ])
            .send()
            .await?
            .json()
            .await?;
        let items = data
            .results
            .into_iter()
            .map(|s| MetadataGroupSearchItem {
                name: s.name,
                parts: s.issue_count,
                identifier: s.id.to_string(),
                ..Default::default()
            })
            .collect();
        Ok(SearchResults {
            items,
            details: SearchDetails {
                total_items: data.count,
                next_page: compute_next_page(page, data.count),
            },
        })
    }

    async fn metadata_group_details(
        &self,
        identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
        let series_future = self
            .client
            .get(format!("{URL}/series/{identifier}/"))
            .basic_auth(&self.username, Some(&self.password))
            .send();

        let issues_future = self
            .client
            .get(format!("{URL}/series/{identifier}/issue_list/"))
            .basic_auth(&self.username, Some(&self.password))
            .query(&[("page_size", "100")])
            .send();

        let (series_response, issues_response) = try_join!(series_future, issues_future)?;
        let series: SeriesDetail = series_response.json().await?;
        let issues: PaginatedResponse<IssueListItem> = issues_response.json().await?;

        let members = issues
            .results
            .into_iter()
            .map(|i| PartialMetadataWithoutId {
                image: i.image,
                lot: MediaLot::ComicBook,
                source: MediaSource::Metron,
                identifier: i.id.to_string(),
                title: issue_title(&i.series.name, &i.number),
                publish_year: i.cover_date.and_then(|d| parse_date(&d)).map(|d| d.year()),
            })
            .collect_vec();

        let group = MetadataGroupWithoutId {
            title: series.name,
            lot: MediaLot::ComicBook,
            description: series.desc,
            source: MediaSource::Metron,
            assets: EntityAssets::default(),
            identifier: series.id.to_string(),
            parts: series.issue_count.unwrap_or(0) as i32,
            source_url: Some(format!("https://metron.cloud/series/{}", identifier)),
            ..Default::default()
        };

        Ok((group, members))
    }
}
