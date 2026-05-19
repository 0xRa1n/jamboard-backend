const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createBoardsService } = require("../../services/boardsService");

function makeQueryStub(calls) {
  return async (text, params = []) => {
    const normalized = String(text).replace(/\s+/g, " ").trim();
    calls.push({ normalized, params });

    if (normalized.startsWith("INSERT INTO boards")) {
      return {
        rows: [
          {
            id: 1,
            title: params[2],
            created_at: "2025-01-01T00:00:00.000Z",
            updated_at: "2025-01-01T00:00:00.000Z",
          },
        ],
      };
    }

    if (normalized.startsWith("SELECT share_token, share_permission FROM boards")) {
      return { rows: [{ share_token: null, share_permission: "view" }] };
    }

    if (normalized.startsWith("UPDATE boards SET share_token")) {
      return { rows: [{ id: 1 }] };
    }

    throw new Error(`Unexpected query: ${normalized}`);
  };
}

test("createBoard normalizes the title", async () => {
  const calls = [];
  const query = makeQueryStub(calls);
  const boardsService = createBoardsService({ query });

  const board = await boardsService.createBoard(1, 2, "  My@Board!!  ");

  assert.equal(board.title, "MyBoard");
  assert.equal(calls[0].params[2], "MyBoard");
});

test("createShareToken generates a token when missing", async () => {
  const calls = [];
  const cryptoStub = {
    randomBytes: () => Buffer.from("token-token-token", "utf-8"),
  };
  const query = makeQueryStub(calls);
  const boardsService = createBoardsService({ query, cryptoImpl: cryptoStub });

  const result = await boardsService.createShareToken(1, 2);
  const expectedToken = Buffer.from("token-token-token", "utf-8").toString("hex");

  assert.deepEqual(result, {
    shareToken: expectedToken,
    sharePermission: "view",
  });
});
