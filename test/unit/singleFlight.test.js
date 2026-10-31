const { describe, it } = require("node:test");
const assert = require("node:assert");
const SingleFlight = require("../../singleFlight");

describe("SingleFlight Request Coalescing (Stampede Protection)", () => {
  it("should coalesce multiple concurrent calls into a single invocation", async () => {
    const group = new SingleFlight();
    let invocations = 0;

    const workerFn = async () => {
      invocations++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "coalesced_result";
    };

    // Trigger 5 concurrent requests for the same key
    const promises = [
      group.do("target_resource", workerFn),
      group.do("target_resource", workerFn),
      group.do("target_resource", workerFn),
      group.do("target_resource", workerFn),
      group.do("target_resource", workerFn)
    ];

    const results = await Promise.all(promises);

    assert.strictEqual(invocations, 1); // Only ONE execution occurred!
    assert.deepStrictEqual(results, [
      "coalesced_result",
      "coalesced_result",
      "coalesced_result",
      "coalesced_result",
      "coalesced_result"
    ]);
  });

  it("should permit fresh execution after previous in-flight call finishes", async () => {
    const group = new SingleFlight();
    let counter = 0;

    const res1 = await group.do("key", async () => ++counter);
    assert.strictEqual(res1, 1);

    const res2 = await group.do("key", async () => ++counter);
    assert.strictEqual(res2, 2);
  });
});

