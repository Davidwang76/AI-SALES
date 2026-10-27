import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import Decimal from "decimal.js";
export class BusinessError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}
export function ensure(
  ok: unknown,
  code: string,
  message: string,
  status = 422,
): asserts ok {
  if (!ok) throw new BusinessError(code, message, status);
}
export const hash = (x: unknown) =>
  createHash("sha256")
    .update(typeof x === "string" ? x : JSON.stringify(x))
    .digest("hex");
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function checkPassword(password: string, stored: string) {
  const [salt, key] = stored.split(":");
  const a = Buffer.from(key, "hex");
  const b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function scoreDimensions(
  dims: { state: string; value?: number | null; weight: number }[],
) {
  const total = dims.reduce((s, d) => s + d.weight, 0);
  let weight = 0,
    points = 0;
  for (const d of dims) {
    if (d.state === "known" && d.value != null) {
      weight += d.weight;
      points += d.value * d.weight;
    }
  }
  return {
    known_score: weight ? Number((points / weight).toFixed(2)) : null,
    coverage: total ? Number(((weight / total) * 100).toFixed(2)) : 0,
  };
}
export function quoteCalculation(x: {
  cost: string;
  quantity: string;
  pack: string;
  fees: string;
  margin: string;
  fx: string;
  direction: "cost_to_quote" | "quote_to_cost";
}) {
  const cost = new Decimal(x.cost),
    qty = new Decimal(x.quantity),
    pack = new Decimal(x.pack),
    fees = new Decimal(x.fees),
    margin = new Decimal(x.margin),
    fx = new Decimal(x.fx);
  ensure(
    cost.gte(0) &&
      qty.gt(0) &&
      pack.gt(0) &&
      fees.gte(0) &&
      fx.gt(0) &&
      margin.gte(0) &&
      margin.lt(1),
    "INVALID_CALCULATION",
    "数量、汇率、包装及毛利率不合法",
  );
  const unitCost = cost.div(pack).plus(fees.div(qty));
  const converted =
    x.direction === "cost_to_quote" ? unitCost.mul(fx) : unitCost.div(fx);
  const price = converted
    .div(new Decimal(1).minus(margin))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const amount = price.mul(qty).toDecimalPlaces(2);
  const totalCost = converted.mul(qty).toDecimalPlaces(2);
  return {
    unit_price: price.toFixed(2),
    amount: amount.toFixed(2),
    cost_total: totalCost.toFixed(2),
    gross_profit: amount.minus(totalCost).toFixed(2),
    actual_margin: amount.isZero()
      ? "0"
      : amount.minus(totalCost).div(amount).toFixed(6),
  };
}
export const safeCsv = (value: unknown) => {
  let s = String(value ?? "");
  if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
export function validateClaims(
  result: any,
  source: { id: string; body: string },
) {
  ensure(
    result && result.schema_version === 1 && Array.isArray(result.claims),
    "AI_SCHEMA_INVALID",
    "模型结构不合法",
  );
  for (const claim of result.claims) {
    ensure(
      ["extracted", "inferred", "unknown", "conflicted"].includes(
        claim.fact_status,
      ),
      "AI_UNSAFE_FACT",
      "模型不能确认业务事实",
    );
    ensure(
      typeof claim.field_path === "string" &&
        claim.field_path.length < 100 &&
        typeof claim.value === "string" &&
        claim.value.length <= 4000,
      "AI_SCHEMA_INVALID",
      "字段格式不正确",
    );
    ensure(
      Array.isArray(claim.evidence) && claim.evidence.length > 0,
      "AI_EVIDENCE_REQUIRED",
      "缺少证据",
    );
    for (const e of claim.evidence)
      ensure(
        e.source_id === source.id &&
          typeof e.quote === "string" &&
          e.quote.length > 0 &&
          source.body.includes(e.quote),
        "AI_EVIDENCE_INVALID",
        "引用不在已授权原件中",
      );
  }
  return result;
}
export function criticalTokens(text: string) {
  return (
    text.match(/\b(?:[A-Z]{3}|\d[\d.,/-]*|FOB|CIF|EXW|piece|pcs|box)\b/g) || []
  )
    .sort()
    .join("|");
}
