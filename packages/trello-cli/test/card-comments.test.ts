import { TrelloClient } from "trello.js";
import { fetchCardComments } from "../src/card-comments";

it("passes pagination parameters through the installed client transport", async () => {
  const firstPage = Array.from({ length: 1000 }, (_, i) => ({ id: `action${i}` }));
  const lastPage = [{ id: "oldest" }];
  const requests: { url?: string; params: Record<string, unknown> }[] = [];
  const client = new TrelloClient({
    key: "fake_api_key",
    token: "fake_token",
    baseRequestConfig: {
      adapter: async (config) => {
        requests.push({ url: config.url, params: config.params });
        return {
          data: requests.length === 1 ? firstPage : lastPage,
          status: 200,
          statusText: "OK",
          headers: {},
          config,
        };
      },
    },
  });

  const comments = await fetchCardComments(client, "card123");

  expect(comments).toEqual([...firstPage, ...lastPage]);
  expect(requests).toHaveLength(2);
  expect(requests[0].url).toBe("/cards/card123/actions");
  expect(requests[0].params).toMatchObject({ filter: "commentCard", limit: 1000 });
  expect(requests[0].params).not.toHaveProperty("before");
  expect(requests[1].url).toBe("/cards/card123/actions");
  expect(requests[1].params).toMatchObject({
    filter: "commentCard", limit: 1000, before: "action999",
  });
});
