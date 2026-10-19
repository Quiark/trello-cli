import { runCommand } from "@oclif/test";
import Config from "@trello-cli/config";
import { Command, ux } from "@oclif/core";
import Cache from "@trello-cli/cache";
import * as path from "path";

let progress: jest.SpyInstance;
let output: jest.SpyInstance;
const originalDbDir = process.env.TRELLO_CLI_DB_DIR;
const originalProfile = process.env.TRELLO_CLI_PROFILE;

const mockSync = jest.fn(async (onProgress: (message: string) => void) => {
  onProgress("Fetching open boards...");
  onProgress("Saving 42 cards from 1 boards...");
});

jest.mock("@trello-cli/cache", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ sync: mockSync })),
}));

beforeEach(() => {
  delete process.env.TRELLO_CLI_DB_DIR;
  delete process.env.TRELLO_CLI_PROFILE;
  jest.mocked(Cache).mockClear();
  jest.spyOn(Config.prototype, "getToken").mockResolvedValue("fake_token");
  jest.spyOn(Config.prototype, "getApiKey").mockResolvedValue("fake_api_key");
  mockSync.mockClear();
  progress = jest.spyOn(Command.prototype, "logToStderr").mockImplementation(() => {});
  output = jest.spyOn(ux, "stdout").mockImplementation(() => {});
});

afterEach(() => {
  if (originalDbDir === undefined) delete process.env.TRELLO_CLI_DB_DIR;
  else process.env.TRELLO_CLI_DB_DIR = originalDbDir;
  if (originalProfile === undefined) delete process.env.TRELLO_CLI_PROFILE;
  else process.env.TRELLO_CLI_PROFILE = originalProfile;
  jest.restoreAllMocks();
});

describe("sync", () => {
  it.each([
    [undefined, undefined],
    ["", undefined],
    [undefined, "work"],
    ["/data/trello", undefined],
    ["/data/trello", "work"],
  ])("uses database root %s with profile %s", async (directory, profile) => {
    if (directory !== undefined) process.env.TRELLO_CLI_DB_DIR = directory;
    if (profile !== undefined) process.env.TRELLO_CLI_PROFILE = profile;
    const { error } = await runCommand(["sync"]);
    expect(error).toBeUndefined();
    const home = process.env[process.platform === "win32" ? "USERPROFILE" : "HOME"]!;
    expect(Cache).toHaveBeenCalledWith(
      path.join(directory || path.join(home, ".trello-cli"), profile || "default"),
      "fake_api_key",
      "fake_token"
    );
  });

  it("reports progress on stderr and completion on stdout", async () => {
    const { error } = await runCommand(["sync"]);
    expect(error).toBeUndefined();
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith("Fetching open boards...");
    expect(progress).toHaveBeenCalledWith("Saving 42 cards from 1 boards...");
    expect(output).toHaveBeenCalledWith("Sync complete");
  });

  it("keeps JSON output separate from progress", async () => {
    const { error } = await runCommand(["sync", "--format", "json"]);
    expect(error).toBeUndefined();
    expect(output).toHaveBeenCalledWith(JSON.stringify("Sync complete"));
    expect(progress).toHaveBeenCalledWith("Fetching open boards...");
  });

  it("suppresses progress and completion in silent mode", async () => {
    const { error } = await runCommand(["sync", "--format", "silent"]);
    expect(error).toBeUndefined();
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(output).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });
});
