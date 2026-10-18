import { runCommand } from "@oclif/test";
import Config from "@trello-cli/config";
import { ux } from "@oclif/core";

const mockActions = [
  {
    id: "action1",
    data: { text: "First comment" },
    memberCreator: { fullName: "John Doe" },
    date: "2026-01-15T10:00:00.000Z",
  },
  {
    id: "action2",
    data: { text: "Second comment" },
    memberCreator: { fullName: "Jane Smith" },
    date: "2026-01-16T12:00:00.000Z",
  },
];

const sendRequest = jest.fn().mockResolvedValue(mockActions);
const getListCards = jest.fn().mockResolvedValue([
  { id: "card123", name: "TestCard" },
]);

jest.mock("trello.js", () => ({
  TrelloClient: jest.fn().mockImplementation(() => ({
    sendRequest,
    lists: { getListCards },
  })),
}));

const mockGetBoardIdByName = jest.fn().mockResolvedValue("board123");
const mockGetListIdByBoardAndName = jest.fn().mockResolvedValue("list123");

jest.mock("@trello-cli/cache", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      getBoardIdByName: mockGetBoardIdByName,
      getListIdByBoardAndName: mockGetListIdByBoardAndName,
    })),
  };
});

let stdoutSpy: jest.SpyInstance;

beforeEach(() => {
  jest
    .spyOn(Config.prototype, "getToken")
    .mockImplementation(() => Promise.resolve("fake_token"));
  jest
    .spyOn(Config.prototype, "getApiKey")
    .mockImplementation(() => Promise.resolve("fake_api_key"));

  stdoutSpy = jest.spyOn(ux, "stdout").mockImplementation(() => {});

  sendRequest.mockReset().mockResolvedValue(mockActions);
  getListCards.mockClear();
  mockGetBoardIdByName.mockClear();
  mockGetListIdByBoardAndName.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("card:comments", () => {
  it("throws when required flags are missing", async () => {
    const { error } = await runCommand(["card:comments"]);
    expect(error?.message).toContain("Missing required flag");
  });

  it("requests comments with pagination params", async () => {
    const { error } = await runCommand([
      "card:comments",
      "--board", "MyBoard",
      "--list", "ToDo",
      "--card", "TestCard",
      "--format", "json",
    ]);
    expect(error).toBeUndefined();
    expect(sendRequest).toHaveBeenCalledTimes(1);
    expect(sendRequest).toHaveBeenCalledWith({
      url: "/cards/card123/actions",
      method: "GET",
      params: { filter: "commentCard", limit: 1000 },
    });
  });

  it("outputs correct JSON shape", async () => {
    await runCommand([
      "card:comments",
      "--board", "MyBoard",
      "--list", "ToDo",
      "--card", "TestCard",
      "--format", "json",
    ]);

    const outputCall = stdoutSpy.mock.calls[0][0];
    const output = JSON.parse(outputCall);
    expect(output).toHaveLength(2);
    expect(output[0].id).toBe("action1");
    expect(output[0].text).toBe("First comment");
    expect(output[0].author).toBe("John Doe");
    expect(output[0].date).toBe("2026-01-15T10:00:00.000Z");
  });

  it("handles empty comments array", async () => {
    sendRequest.mockResolvedValueOnce([]);
    await runCommand([
      "card:comments",
      "--board", "MyBoard",
      "--list", "ToDo",
      "--card", "TestCard",
      "--format", "json",
    ]);

    const outputCall = stdoutSpy.mock.calls[0][0];
    const output = JSON.parse(outputCall);
    expect(output).toHaveLength(0);
  });
});

describe.each([
  ["card:comments-by-id", ["--id", "card123"]],
  ["card:comments", ["--board", "MyBoard", "--list", "ToDo", "--card", "TestCard"]],
])("%s pagination", (command, flags) => {
  it("fetches all pages for only the requested card, preserving order", async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({
      ...mockActions[0], id: `action${i}`,
    }));
    sendRequest.mockResolvedValueOnce(page).mockResolvedValueOnce([mockActions[1]]);

    const { error } = await runCommand([command, ...flags, "--format", "json"]);

    expect(error).toBeUndefined();
    expect(sendRequest).toHaveBeenCalledTimes(2);
    expect(sendRequest).toHaveBeenNthCalledWith(1, {
      url: "/cards/card123/actions",
      method: "GET",
      params: { filter: "commentCard", limit: 1000 },
    });
    expect(sendRequest).toHaveBeenNthCalledWith(2, {
      url: "/cards/card123/actions",
      method: "GET",
      params: { filter: "commentCard", limit: 1000, before: "action999" },
    });
    const output = JSON.parse(stdoutSpy.mock.calls[0][0]);
    expect(output.map((comment: { id: string }) => comment.id)).toEqual([
      ...page.map((action) => action.id), mockActions[1].id,
    ]);
    if (command === "card:comments-by-id") {
      expect(getListCards).not.toHaveBeenCalled();
      expect(mockGetBoardIdByName).not.toHaveBeenCalled();
      expect(mockGetListIdByBoardAndName).not.toHaveBeenCalled();
    }
  });

  it("stops on an empty page after an exact page-size result", async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({
      ...mockActions[0], id: `action${i}`,
    }));
    sendRequest.mockResolvedValueOnce(page).mockResolvedValueOnce([]);

    const { error } = await runCommand([command, ...flags, "--format", "json"]);

    expect(error).toBeUndefined();
    expect(sendRequest).toHaveBeenCalledTimes(2);
    expect(JSON.parse(stdoutSpy.mock.calls[0][0])).toHaveLength(1000);
  });

  it("prints No comments for an empty result", async () => {
    sendRequest.mockResolvedValueOnce([]);

    const { error } = await runCommand([command, ...flags]);

    expect(error).toBeUndefined();
    expect(stdoutSpy).toHaveBeenCalledWith("No comments");
    expect(sendRequest).toHaveBeenCalledTimes(1);
  });

  it("propagates later page failures without outputting partial results", async () => {
    sendRequest
      .mockResolvedValueOnce(Array(1000).fill(mockActions[0]))
      .mockRejectedValueOnce(new Error("Trello unavailable"));

    const { error } = await runCommand([command, ...flags, "--format", "json"]);

    expect(error?.message).toContain("Trello unavailable");
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("fails rather than looping when the cursor does not advance", async () => {
    sendRequest.mockResolvedValue(Array(1000).fill(mockActions[0]));

    const { error } = await runCommand([command, ...flags, "--format", "json"]);

    expect(error?.message).toContain("Comment pagination did not advance");
    expect(sendRequest).toHaveBeenCalledTimes(2);
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
