import { test } from "node:test";
import assert from "node:assert/strict";
import {
  quoteCalculation,
  scoreDimensions,
  safeCsv,
  validateClaims,
  criticalTokens,
} from "../packages/domain/rules.js";
test("AC-QTE-01: CNY72 / USD7.2 / 20%毛利 / 100件", () => {
  assert.deepEqual(
    quoteCalculation({
      cost: "72",
      quantity: "100",
      pack: "1",
      fees: "0",
      margin: "0.2",
      fx: "7.2",
      direction: "quote_to_cost",
    }),
    {
      unit_price: "12.50",
      amount: "1250.00",
      cost_total: "1000.00",
      gross_profit: "250.00",
      actual_margin: "0.200000",
    },
  );
});
test("AC-QTE-02: 反向汇率与箱规费用计算", () => {
  const a = quoteCalculation({
    cost: "100",
    quantity: "10",
    pack: "10",
    fees: "10",
    margin: "0.2",
    fx: "0.5",
    direction: "cost_to_quote",
  });
  assert.equal(a.unit_price, "6.88");
  assert.equal(a.amount, "68.80");
});
test("AC-QTE-02: 非法数量、汇率和毛利阻断", () => {
  for (const patch of [
    { quantity: "0" },
    { quantity: "-1" },
    { margin: "1" },
    { fx: "0" },
    { pack: "0" },
  ])
    assert.throws(() =>
      quoteCalculation({
        cost: "72",
        quantity: "100",
        pack: "1",
        fees: "0",
        margin: "0.2",
        fx: "7.2",
        direction: "quote_to_cost",
        ...patch,
      }),
    );
});
test("AC-BKG-02: 两项已知90分，覆盖50%，未知不当零", () => {
  assert.deepEqual(
    scoreDimensions([
      { state: "known", value: 100, weight: 1 },
      { state: "known", value: 80, weight: 1 },
      { state: "unknown", weight: 1 },
      { state: "conflicted", weight: 1 },
    ]),
    { known_score: 90, coverage: 50 },
  );
  assert.equal(
    scoreDimensions([{ state: "unknown", weight: 1 }]).known_score,
    null,
  );
});
test("AC-SEC-03: CSV公式防护包含空白前缀", () => {
  for (const value of ["=1+1", "+CMD", "-2", "@SUM(A1)", "  =1+1", "\t=1"])
    assert.ok(safeCsv(value).startsWith("\"'"));
});
test("AC-AI-02: 虚构来源和confirmed事实被拒绝", () => {
  const source = { id: "s1", body: "Imports auto parts" };
  const good = {
    schema_version: 1,
    claims: [
      {
        field_path: "type",
        value: "importer",
        fact_status: "extracted",
        evidence: [{ source_id: "s1", quote: "Imports" }],
      },
    ],
  };
  assert.equal(validateClaims(good, source), good);
  assert.throws(() =>
    validateClaims(
      { ...good, claims: [{ ...good.claims[0], fact_status: "confirmed" }] },
      source,
    ),
  );
  assert.throws(() =>
    validateClaims(
      {
        ...good,
        claims: [
          {
            ...good.claims[0],
            evidence: [{ source_id: "fake", quote: "Imports" }],
          },
        ],
      },
      source,
    ),
  );
  assert.throws(() => validateClaims({}, source));
});
test("AC-COM-03: 翻译数量和币种漂移识别", () => {
  assert.notEqual(
    criticalTokens("OE 1234 100 pcs USD"),
    criticalTokens("OE 1234 10 pcs CNY"),
  );
});
