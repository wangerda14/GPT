const API = "https://typhoon.slt.zj.gov.cn/Api";
const upstreamHeaders = {
  Accept: "application/json",
  Referer: "https://typhoon.slt.zj.gov.cn/",
  "User-Agent": "guangdong-typhoon-netlify/1.0"
};

async function json(url) {
  const response = await fetch(url, { headers: upstreamHeaders, signal: AbortSignal.timeout(18000) });
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  return response.json();
}
function list(value) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "rows", "list", "result"]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}
const num = value => Number.isFinite(Number(value)) ? Number(value) : null;
function point(p, phase = "observed", agency = null) {
  return {
    time: p.time || p.datetime || null,
    lat: num(p.lat), lng: num(p.lng ?? p.lon),
    power: num(p.power), speed: num(p.speed), pressure: num(p.pressure),
    strong: p.strong || null,
    moveDirection: p.movedirection || p.moveDirection || null,
    moveSpeed: num(p.movespeed ?? p.moveSpeed),
    radius7: p.radius7 || null, radius10: p.radius10 || null, radius12: p.radius12 || null,
    phase, agency
  };
}
async function activeList() {
  try { return list(await json(`${API}/TyhoonActivity`)); }
  catch {
    const year = new Date(Date.now() + 8 * 3600000).getUTCFullYear();
    return list(await json(`${API}/TyphoonList/${year}`)).filter(x => String(x.isactive) === "1");
  }
}
async function storm(item) {
  const id = String(item.tfid || item.id || "");
  const detail = await json(`${API}/TyphoonInfo/${encodeURIComponent(id)}`);
  const raw = list(detail.points || detail);
  const observed = raw.map(p => point(p)).filter(p => p.lat !== null && p.lng !== null);
  const latestRaw = raw.at(-1) || item;
  const forecasts = (Array.isArray(latestRaw.forecast) ? latestRaw.forecast : []).map(group => ({
    agency: group.tm || group.name || "未标明机构",
    points: list(group.forecastpoints || group.points).map(p => point(p, "forecast", group.tm || group.name || null)).filter(p => p.lat !== null && p.lng !== null)
  }));
  return {
    id, name: detail.name || item.name || "未命名", enName: detail.enname || item.enname || "",
    isActive: true, latest: point(latestRaw), observed, forecasts
  };
}
export default async function handler(request) {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  try {
    const active = await activeList();
    const storms = [];
    for (const item of active) {
      try { storms.push(await storm(item)); } catch (error) { console.error("Typhoon detail failed", error); }
    }
    return Response.json({
      schemaVersion: 1, status: "ok", fetchedAt: new Date().toISOString(),
      source: { name: "浙江省水利厅台风路径实时发布系统", homepage: "https://typhoon.slt.zj.gov.cn/" },
      focus: { province: "广东省", note: "距离为台风中心至广东沿海城市中心的直线估算" },
      storms
    }, { headers: {
      "Cache-Control": "public, max-age=60, s-maxage=900, stale-while-revalidate=3600",
      "Access-Control-Allow-Origin": "*"
    }});
  } catch (error) {
    return Response.json({ status: "error", fetchedAt: new Date().toISOString(), message: "官方数据暂时不可用" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
export const config = { path: "/api/typhoon" };
