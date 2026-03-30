import { Client } from "pg";

export class ReportExecutionLock {
  private client: Client | null = null;

  constructor(
    private readonly databaseUrl: string,
    private readonly lockId: bigint
  ) {}

  async tryAcquire() {
    if (this.client) {
      return true;
    }

    const client = new Client({
      connectionString: this.databaseUrl
    });

    await client.connect();
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
      [this.lockId.toString()]
    );

    if (!result.rows[0]?.acquired) {
      await client.end();
      return false;
    }

    this.client = client;
    return true;
  }

  async release() {
    if (!this.client) {
      return;
    }

    try {
      await this.client.query("SELECT pg_advisory_unlock($1::bigint)", [this.lockId.toString()]);
    } finally {
      await this.client.end().catch(() => undefined);
      this.client = null;
    }
  }
}

