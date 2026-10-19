import { BaseCommand } from "../../BaseCommand";

export default class SyncIndex extends BaseCommand<typeof SyncIndex> {
  static description = "Build a local cache of name to ID mappings";

  protected defaultOutput = "raw" as const;

  async run(): Promise<void> {
    await this.cache.sync((message: string) => {
      if (this.flags.format !== "silent") this.logToStderr(message);
    });
    this.output("Sync complete");
  }
}
