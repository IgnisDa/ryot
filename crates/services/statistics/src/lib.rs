use std::collections::HashMap;

use async_graphql::Result;
use chrono::Datelike;
use database_models::{daily_user_activity, prelude::DailyUserActivity};
use database_utils::consolidate_activities;
use dependent_models::{DailyUserActivitiesResponse, DailyUserActivitiesResponseGroupedBy};
use media_models::DailyUserActivitiesInput;
use sea_orm::{
    prelude::Date, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryTrait,
};

#[derive(Debug)]
pub struct StatisticsService {
    db: DatabaseConnection,
}

impl StatisticsService {
    pub fn new(db: &DatabaseConnection) -> Self {
        Self { db: db.clone() }
    }

    pub async fn daily_user_activities(
        &self,
        user_id: String,
        input: DailyUserActivitiesInput,
    ) -> Result<DailyUserActivitiesResponse> {
        static MAX_DAILY_USER_ACTIVITIES: usize = 30;
        let items = DailyUserActivity::find()
            .filter(daily_user_activity::Column::UserId.eq(&user_id))
            .apply_if(input.end_date, |query, v| {
                query.filter(daily_user_activity::Column::Date.lte(v))
            })
            .apply_if(input.start_date, |query, v| {
                query.filter(daily_user_activity::Column::Date.gte(v))
            })
            .all(&self.db)
            .await?;
        let grouped_by = match items.len() > MAX_DAILY_USER_ACTIVITIES {
            true => DailyUserActivitiesResponseGroupedBy::Month,
            false => DailyUserActivitiesResponseGroupedBy::Day,
        };
        let items = match grouped_by {
            DailyUserActivitiesResponseGroupedBy::Day => items,
            DailyUserActivitiesResponseGroupedBy::Month => {
                let mut grouped_activities: HashMap<Date, Vec<_>> = HashMap::new();
                for item in items {
                    let start_of_month = item.date.with_day(1).unwrap();
                    grouped_activities
                        .entry(start_of_month)
                        .and_modify(|e| e.push(item.clone()))
                        .or_insert(vec![item.clone()]);
                }
                let mut items = vec![];
                for (date, activities) in grouped_activities.into_iter() {
                    let consolidated_activity = consolidate_activities(activities);
                    items.push(daily_user_activity::Model {
                        date,
                        ..consolidated_activity
                    });
                }
                items.sort_by_key(|i| i.date);
                items
            }
        };
        let hours = items.iter().flat_map(|i| i.hour_counts.clone());
        let hours = hours.fold(HashMap::new(), |mut acc, i| {
            acc.entry(i.hour)
                .and_modify(|e| *e += i.count)
                .or_insert(i.count);
            acc
        });
        let most_active_hour = hours.iter().max_by_key(|(_, v)| *v).map(|(k, _)| *k);
        let total_count = items.iter().map(|i| i.total_counts).sum();
        Ok(DailyUserActivitiesResponse {
            items,
            grouped_by,
            total_count,
            most_active_hour,
        })
    }
}
