export let entity = "";
export const setEntity = (v: string) => {
  entity = v;
};
export async function api(url: string, method = "GET", data?: unknown) {
  const r = await fetch("/api/v1/" + url, {
    method,
    headers: {
      ...(entity ? { "X-Entity-Id": entity } : {}),
      ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  const v = await r.json();
  if (!r.ok) throw new Error(v.error?.message || "请求失败");
  return v.data;
}
export async function download(url: string) {
  const r = await fetch("/api/v1/" + url, {
    headers: { "X-Entity-Id": entity },
  });
  if (!r.ok) {
    const v = await r.json();
    throw new Error(v.error?.message || "下载失败");
  }
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download =
    url.includes("export") && url !== "exports/accounts"
      ? "business-document.html"
      : "accounts.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
