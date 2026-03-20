import { BaseCommand } from "../../BaseCommand";
import { Flags } from "@oclif/core";

export default class GetById extends BaseCommand<typeof GetById> {
  static description = "Show card details by ID";

  protected defaultOutput = "fancy" as const;

  static flags = {
    id: Flags.string({ required: true, description: "The Trello card ID" }),
    comments: Flags.boolean({
      description: "Include comments on the card",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const card = await this.client.cards.getCard({
      id: this.flags.id,
    });

    let comments: any[] = [];
    if (this.flags.comments) {
      const actions = await this.client.cards.getCardActions({
        id: this.flags.id,
        filter: "commentCard",
      });
      comments = actions;
    }

    this.output({ ...card, comments });
  }

  protected async toData(data: any) {
    const result: any = {
      id: data.id,
      name: data.name,
      due: data.due,
      description: data.desc,
      labels: data.labels,
      url: data.url,
      members: await this.cache.convertMemberIdsToEntity(data.idMembers),
      list: data.idList,
    };

    if (data.comments && data.comments.length > 0) {
      result.comments = data.comments.map((action: any) => ({
        id: action.id,
        text: action.data.text,
        author: action.memberCreator.fullName,
        date: action.date,
      }));
    }

    return result;
  }

  protected async format(data: any): Promise<string> {
    const labels = data.labels?.map((l: any) => l.name).join(", ") || "None";
    const members =
      data.members?.map((m: any) => m.fullName).join(", ") || "None";
    const lines = [
      `Name: ${data.name}`,
      `ID: ${data.id}`,
      `URL: ${data.url}`,
      `Due: ${data.due || "None"}`,
      `Labels: ${labels}`,
      `Members: ${members}`,
      `List ID: ${data.list}`,
      `Description: ${data.description || "None"}`,
    ];

    if (data.comments && data.comments.length > 0) {
      lines.push("");
      lines.push("Comments:");
      data.comments.forEach((c: any) => {
        lines.push(`  ${c.author} [${c.date}]: ${c.text}`);
      });
    }

    return lines.join("\n");
  }
}
