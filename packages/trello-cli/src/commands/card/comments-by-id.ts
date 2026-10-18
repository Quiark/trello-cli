import { BaseCommand } from "../../BaseCommand";
import { Flags } from "@oclif/core";

export default class CardCommentsById extends BaseCommand<typeof CardCommentsById> {
  static description = "List comments on a card by ID";

  protected defaultOutput = "fancy" as const;

  static flags = {
    id: Flags.string({ required: true, description: "The Trello card ID" }),
  };

  async run(): Promise<void> {
    const actions = await this.client.cards.getCardActions({
      id: this.flags.id,
      filter: "commentCard",
    });
    this.output(actions);
  }

  protected toData(data: any) {
    return data.map((action: any) => ({
      id: action.id,
      text: action.data.text,
      author: action.memberCreator.fullName,
      date: action.date,
    }));
  }

  protected async format(data: any): Promise<string> {
    if (data.length === 0) {
      return "No comments";
    }
    return data
      .map((c: any) => `${c.author} [${c.date}]: ${c.text}`)
      .join("\n");
  }
}
