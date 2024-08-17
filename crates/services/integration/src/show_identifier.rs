use sea_orm::{DatabaseConnection, EntityTrait, QueryFilter, ColumnTrait, Condition};
use sea_query::{Expr, Func, Alias};
use anyhow::{Result, bail};
use sea_orm::prelude::async_trait::async_trait;
use sea_query::extension::postgres::PgExpr;
use database_utils::ilike_sql;
use crate::{metadata, MediaLot, MediaSource};

#[async_trait]
pub trait ShowIdentifier {
    fn get_db(&self) -> &DatabaseConnection;

    async fn get_show_by_episode_identifier(
        &self,
        series: &str,
        episode: &str,
    ) -> Result<metadata::Model> {
        let db_show = metadata::Entity::find()
            .filter(metadata::Column::Lot.eq(MediaLot::Show))
            .filter(metadata::Column::Source.eq(MediaSource::Tmdb))
            .filter(
                Condition::all()
                    .add(
                        Expr::expr(Func::cast_as(
                            Expr::col(metadata::Column::ShowSpecifics),
                            Alias::new("text"),
                        ))
                            .ilike(ilike_sql(episode)),
                    )
                    .add(Expr::col(metadata::Column::Title).ilike(ilike_sql(series))),
            )
            .one(self.get_db())
            .await?;
        match db_show {
            Some(show) => Ok(show),
            None => bail!(
                "No show found with Series {:#?} and Episode {:#?}",
                series,
                episode
            ),
        }
    }
}
