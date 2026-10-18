import { Models, TrelloClient } from "trello.js";

export async function fetchCardComments(
  client: TrelloClient,
  cardId: string
): Promise<Models.Action[]> {
  const comments: Models.Action[] = [];
  const limit = 1000;
  let before: string | undefined;

  while (true) {
    // getCardActions in trello.js drops limit and before; use its transport directly.
    const page = await client.sendRequest<Models.Action[]>({
      url: `/cards/${encodeURIComponent(cardId)}/actions`,
      method: "GET",
      params: { filter: "commentCard", limit, ...(before ? { before } : {}) },
    });
    comments.push(...page);
    if (page.length < limit) {
      return comments;
    }

    const nextBefore = page[page.length - 1].id;
    if (nextBefore === before) {
      throw new Error("Comment pagination did not advance");
    }
    before = nextBefore;
  }
}
