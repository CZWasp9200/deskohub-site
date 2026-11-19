import { Context, Duration, Effect, Layer } from "effect";
import {
  databaseClient,
  databasePostgresLayer,
  type RootDatabaseClient,
} from "../../db/database-client";
import type { DatasourceConfig } from "../config";

interface IE2EDatabase {
  readonly db: RootDatabaseClient;
}

export class E2EDatabase extends Context.Service<E2EDatabase, IE2EDatabase>()(
  "E2EDatabase"
) {
  static layer = (
    config: Pick<DatasourceConfig, "databaseUrlUnpooled" | "timeouts">
  ) =>
    Layer.effect(
      this,
      Effect.map(databaseClient, (db) => E2EDatabase.of({ db }))
    ).pipe(
      Layer.provide(
        databasePostgresLayer({
          connectionString: config.databaseUrlUnpooled,
          maxConnections: 2,
          connectTimeout: Duration.millis(config.timeouts.datasource),
          statementTimeout: Duration.millis(config.timeouts.datasource),
        })
      )
    );
}
