import assert from "node:assert/strict";
import test from "node:test";
import { applyAdminAction } from "../src/account_lifecycle.js";

test("an offboarded tenant cannot be restored by an admin", () => {
  const offboarded = applyAdminAction("active", "offboard");
  assert.equal(offboarded, "offboarded");
  assert.throws(
    () => applyAdminAction(offboarded, "restore"),
    /Cannot restore an account in offboarded/,
  );
});
