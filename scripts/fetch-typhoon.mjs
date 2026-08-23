import { mkdir, readFile, writeFile } from "node:fs/promises";

const API = "https://typhoon.slt.zj.gov.cn/Api";
const OUT = "data/typhoon.json";
const headers = {
  "Accept": "application/json",
  "Referer": "https://typhoon.slt.zj.gov.cn/",
  "User-Agent": "wangerda14-GPT-GitHub-Pages/1.0"
};

async function getJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function listFrom(value) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "rows", "list", "result"]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizePoint(p, phase = "observed", agency = null) {
  return {
    time: p.time || p.datetime || null,
    lat: number(p.lat),
    lng: number(p.lng ?? p.lon),
    power: number(p.power),
    speed: number(p.speed),
    pressure: number(p.pressure),
    strong: p.strong || null,
    moveDirection: p.movedirection || p.moveDirection || null,
    moveSpeed: number(p.movespeed ?? p.moveSpeed),
    radius7: p.radius7 || null,
    radius10: p.radius10 || null,
    radius12: p.radius12 || null,
    phase,
    agency
  };
}

async function loadActive() {
  try {
    return listFrom(await getJSON(`${API}/TyhoonActivity`));
  } catch (activityError) {
    const year = new Date(Date.now() + 8 * 3600_000).getUTCFullYear();
    const all = listFrom(await getJSON(`${API}/TyphoonList/${year}`));
    return all.filter(t => String(t.isactive) === "1");
  }
}

async function buildStorm(item) {
  const id = String(item.tfid || item.id || "");
  const detail = await getJSON(`${API}/TyphoonInfo/${encodeURIComponent(id)}`);
  const points = listFrom(detail.points || detail);
  const observed = points.map(p => normalizePoint(p)).filter(p => p.lat !== null && p.lng !== null);
  const latestRaw = points.at(-1) || item;
  const agencies = Array.isArray(latestRaw.forecast) ? latestRaw.forecast : [];
  const forecasts = agencies.map(group => ({
    agency: group.tm || group.name || "未标明机构",
    points: listFrom(group.forecastpoints || group.points).map(p =>
      normalizePoint(p, "forecast", group.tm || group.name || null)
    ).filter(p => p.lat !== null && p.lng !== null)
  }));
  return {
    id,
    name: detail.name || item.name || "未命名",
    enName: detail.enname || item.enname || "",
    isActive: String(detail.isactive ?? item.isactive ?? "1") === "1",
    warningLevel: detail.warnlevel || item.warnlevel || null,
    startTime: detail.starttime || item.starttime || null,
    latest: normalizePoint(latestRaw),
    observed,
    forecasts,
    officialDetailUrl: `https://typhoon.slt.zj.gov.cn/#/typhoon/${id}`
  };
}

async function previousData() {
  try { return JSON.parse(await readFile(OUT, "utf8")); }
  catch { return null; }
}

const fetchedAt = new Date().toISOString();
await mkdir("data", { recursive: true });

try {
  const active = await loadActive();
  const storms = [];
  const errors = [];
  for (const item of active) {
    try { storms.push(await buildStorm(item)); }
    catch (error) { errors.push({ id: item.tfid || null, message: String(error.message || error) }); }
  }
  const payload = {
    schemaVersion: 1,
    status: errors.length && !storms.length ? "partial_failure" : "ok",
    fetchedAt,
    source: {
      name: "浙江省水利厅台风路径实时发布系统",
      homepage: "https://typhoon.slt.zj.gov.cn/",
      activityApi: `${API}/TyhoonActivity`
    },
    notice: "本页转述公开台风路径数据，不替代气象主管部门发布的预警和防灾指令。",
    storms,
    errors
  };
  await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n");
  console.log(`Saved ${storms.length} active storm(s) to ${OUT}`);
} catch (error) {
  const old = await previousData();
  if (!old) throw error;
  old.status = "stale";
  old.lastFetchAttempt = fetchedAt;
  old.fetchError = String(error.message || error);
  await writeFile(OUT, JSON.stringify(old, null, 2) + "\n");
  console.warn("Upstream fetch failed; retained last successful snapshot.");
}
