#!/usr/bin/env node
/**
 * Profile banner generator for github.com/HajithMohamed
 *
 * Builds dark.svg and light.svg from live GitHub data: curated featured
 * projects plus the most recently pushed repositories, so new work appears
 * in the banner automatically. Zero dependencies (Node 20+).
 *
 *   node scripts/generate-banner.mjs [outDir ...]
 *
 * Env:
 *   GITHUB_TOKEN  optional, raises the GitHub API rate limit
 *   GITHUB_USER   defaults to HajithMohamed
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USER = process.env.GITHUB_USER || "HajithMohamed";
const TOKEN = process.env.GITHUB_TOKEN || "";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIRS = (process.argv.length > 2 ? process.argv.slice(2) : [path.join(SCRIPT_DIR, "..")]).map((dir) =>
  path.resolve(dir),
);

// ─── Curation ──────────────────────────────────────────────────────────────
const MAX_CARDS = 6;
const LATEST_SLOTS = 2; // always reserve slots for the newest pushed repos
const NEW_REPO_DAYS = 45; // repos created within this window get a "NEW" tag

/** Always shown first (order preserved). Missing/renamed repos are skipped and backfilled. */
const FEATURED = [
  {
    repo: "HajithMohamed/Footwear_Business_Management_System",
    title: "Shoe Bank — Footwear BMS",
    blurb: "Business management system: inventory, invoicing, customer credit, cheque tracking and financial reports.",
  },
  {
    repo: "Hz-Labs-studio/Saga-Elite-Web-project",
    title: "Saga Elite — E-Commerce",
    blurb: "Four-member e-commerce platform with JWT auth, real-time Socket.IO events and Playwright CI.",
  },
  {
    repo: "HajithMohamed/Medical-Lab-Resource-Reservation-System",
    title: "BenchBook — Lab Booking",
    blurb: "Lab resource reservations with PostgreSQL conflict constraints, maintenance workflows and Vitest.",
  },
  {
    repo: "akalanka001/-BloodBridge--ADBMS",
    title: "BloodBridge — ADBMS",
    blurb: "PostgreSQL / PL/pgSQL blood inventory prototype with transaction safeguards (merged PR #7).",
  },
];

/** Friendlier titles for auto-selected repos (keys are lowercase full names). */
const TITLE_OVERRIDES = {
  "hajithmohamed/my_portfoli_website": "HZ Labs Portfolio Platform",
};

/** Never auto-select these (lowercase full names). */
const EXCLUDE = new Set([`${USER}/${USER}`.toLowerCase()]);

/** Auto-selection skips repos that look like templates, infra or throwaway experiments. */
const SKIP_NAME = /(trial|template|playground|sandbox|^test|-test$)/i;
const SKIP_LANGUAGES = new Set(["Dockerfile", "Procfile", "Makefile"]);
const SKIP_DESCRIPTION = /^created from /i;

const LANG_COLORS = {
  TypeScript: "#3178C6",
  JavaScript: "#F1E05A",
  PHP: "#4F5D95",
  Java: "#B07219",
  Python: "#3572A5",
  Dart: "#00B4AB",
  HTML: "#E34C26",
  CSS: "#563D7C",
  PLpgSQL: "#336790",
  Shell: "#89E051",
  Vue: "#41B883",
};

const THEMES = {
  dark: {
    bgFrom: "#040714",
    bgTo: "#0B1026",
    grid: "#1E293B",
    title: "#F8FAFC",
    text: "#A5B4C8",
    muted: "#64748B",
    card: "#0F172A",
    cardOpacity: 0.78,
    cardStroke: "#1E293B",
    pillBg: "#0A1128",
    accent: ["#2DD4BF", "#38BDF8", "#818CF8"],
    glow: true,
    tags: { FEATURED: "#38BDF8", LATEST: "#34D399", NEW: "#F59E0B" },
  },
  light: {
    bgFrom: "#F8FAFC",
    bgTo: "#E2E8F0",
    grid: "#CBD5E1",
    title: "#0F172A",
    text: "#475569",
    muted: "#64748B",
    card: "#FFFFFF",
    cardOpacity: 0.92,
    cardStroke: "#CBD5E1",
    pillBg: "#FFFFFF",
    accent: ["#0D9488", "#0284C7", "#4F46E5"],
    glow: false,
    tags: { FEATURED: "#0284C7", LATEST: "#059669", NEW: "#D97706" },
  },
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// ─── Helpers ───────────────────────────────────────────────────────────────
const esc = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const truncate = (value, max) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

const humanize = (name) =>
  name
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const fmtMonth = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
const fmtDay = (date) =>
  date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Word-wraps text into at most `maxLines` lines, adding an ellipsis when cut. */
function wrap(text, maxChars, maxLines) {
  const words = String(text).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let current = "";
  let i = 0;
  for (; i < words.length; i++) {
    const candidate = current ? `${current} ${words[i]}` : words[i];
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (lines.length === maxLines) {
      current = "";
      break;
    }
    current = words[i].slice(0, maxChars);
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (i < words.length && lines.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = `${last.slice(0, maxChars - 1).replace(/[\s,.;:—-]+$/, "")}…`;
  }
  return lines;
}

async function gh(pathname) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `${USER}-profile-banner`,
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${pathname}`);
  return res.json();
}

async function contributionsLastYear() {
  try {
    const res = await fetch(`https://github-contributions-api.jogruber.de/v4/${USER}?y=last`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json?.total?.lastYear === "number" ? json.total.lastYear : null;
  } catch {
    return null;
  }
}

function toCard(repo, { title, blurb, featured } = {}) {
  const isNew = Date.now() - Date.parse(repo.created_at) < NEW_REPO_DAYS * 86_400_000;
  const language = repo.language || "Code";
  return {
    title: title || TITLE_OVERRIDES[repo.full_name.toLowerCase()] || humanize(repo.name),
    slug: repo.full_name,
    collab: repo.owner.login.toLowerCase() !== USER.toLowerCase(),
    description: blurb || repo.description || `Recently active ${language} project — open the repository for details.`,
    language,
    stars: repo.stargazers_count || 0,
    pushedAt: repo.pushed_at,
    tag: featured ? "FEATURED" : isNew ? "NEW" : "LATEST",
  };
}

// ─── Data ──────────────────────────────────────────────────────────────────
async function loadData() {
  const [profile, owned, contributions] = await Promise.all([
    gh(`/users/${USER}`),
    gh(`/users/${USER}/repos?per_page=100&type=owner&sort=pushed`),
    contributionsLastYear(),
  ]);

  const featuredCards = [];
  for (const entry of FEATURED.slice(0, MAX_CARDS - LATEST_SLOTS)) {
    try {
      const repo = await gh(`/repos/${entry.repo}`);
      featuredCards.push(toCard(repo, { ...entry, featured: true }));
    } catch (error) {
      console.warn(`Skipping featured repo ${entry.repo}: ${error.message}`);
    }
  }

  const taken = new Set(featuredCards.map((c) => c.slug.toLowerCase()));
  const latestCards = owned
    .filter((r) => !r.fork && !r.archived && !r.private && r.language && !SKIP_LANGUAGES.has(r.language))
    .filter((r) => !EXCLUDE.has(r.full_name.toLowerCase()) && !taken.has(r.full_name.toLowerCase()))
    .filter((r) => !SKIP_NAME.test(r.name) && !SKIP_DESCRIPTION.test(r.description || ""))
    .sort((a, b) => Date.parse(b.pushed_at) - Date.parse(a.pushed_at))
    .slice(0, MAX_CARDS - featuredCards.length)
    .map((r) => toCard(r));

  return {
    cards: [...featuredCards, ...latestCards],
    publicRepos: profile.public_repos,
    stars: owned.reduce((sum, r) => sum + (r.stargazers_count || 0), 0),
    contributions,
    syncedAt: new Date(),
  };
}

// ─── Rendering ─────────────────────────────────────────────────────────────
function renderCard(t, c, x, y, w, h) {
  const tagColor = t.tags[c.tag];
  const tagW = c.tag.length * 7 + 16;
  const langColor = LANG_COLORS[c.language] || t.muted;
  const desc = wrap(c.description, 48, 2);
  const sub = truncate(c.collab ? `collab · ${c.slug}` : c.slug, 46);
  const meta = [c.language, `★ ${c.stars}`, `Updated ${fmtMonth(c.pushedAt)}`].join("  ·  ");

  return `
  <g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${t.card}" fill-opacity="${t.cardOpacity}" stroke="${t.cardStroke}"/>
    <rect x="${x}" y="${y + 18}" width="3" height="26" rx="1.5" fill="${langColor}"/>
    <text x="${x + 18}" y="${y + 32}" fill="${t.title}" font-family="${FONT}" font-size="14.5" font-weight="700">${esc(truncate(c.title, 28))}</text>
    <rect x="${x + w - 16 - tagW}" y="${y + 17}" width="${tagW}" height="19" rx="9.5" fill="${tagColor}" fill-opacity="0.12" stroke="${tagColor}" stroke-opacity="0.55"/>
    <text x="${x + w - 16 - tagW / 2}" y="${y + 30}" text-anchor="middle" fill="${tagColor}" font-family="${FONT}" font-size="9.5" font-weight="700" letter-spacing="0.8">${c.tag}</text>
    <text x="${x + 18}" y="${y + 51}" fill="${t.muted}" font-family="${MONO}" font-size="10.5">${esc(sub)}</text>
    ${desc
      .map(
        (line, i) =>
          `<text x="${x + 18}" y="${y + 73 + i * 17}" fill="${t.text}" font-family="${FONT}" font-size="12.5">${esc(line)}</text>`,
      )
      .join("\n    ")}
    <circle cx="${x + 22}" cy="${y + h - 17}" r="4" fill="${langColor}"/>
    <text x="${x + 32}" y="${y + h - 13}" fill="${t.muted}" font-family="${FONT}" font-size="11">${esc(meta)}</text>
  </g>`;
}

function render(t, data) {
  const W = 1200;
  const H = 548;
  const pad = 40;
  const gap = 20;
  const cols = 3;
  const cardW = (W - pad * 2 - gap * (cols - 1)) / cols;
  const cardH = 124;
  const cardsTop = 232;

  const stats = [
    `${data.publicRepos} public repos`,
    data.contributions != null ? `${data.contributions.toLocaleString("en-US")} contributions in the last year` : null,
    `★ ${data.stars} stars`,
  ]
    .filter(Boolean)
    .join("  •  ");

  const cards = data.cards
    .map((c, i) =>
      renderCard(t, c, pad + (i % cols) * (cardW + gap), cardsTop + Math.floor(i / cols) * (cardH + 18), cardW, cardH),
    )
    .join("\n");

  const glow = t.glow
    ? `<circle cx="180" cy="70" r="150" fill="#6366F1" opacity="0.16" filter="url(#blur)"/>
  <circle cx="1040" cy="120" r="150" fill="#2DD4BF" opacity="0.12" filter="url(#blur)"/>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Mohamed Hajith — featured GitHub projects">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${t.bgFrom}"/>
      <stop offset="100%" stop-color="${t.bgTo}"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${t.accent[0]}"/>
      <stop offset="50%" stop-color="${t.accent[1]}"/>
      <stop offset="100%" stop-color="${t.accent[2]}"/>
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${t.grid}" stroke-width="0.75" stroke-opacity="0.45"/>
    </pattern>
    <filter id="blur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="40"/>
    </filter>
    <clipPath id="frame"><rect width="${W}" height="${H}" rx="16"/></clipPath>
  </defs>

  <g clip-path="url(#frame)">
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${glow}
  <rect width="${W}" height="${H}" fill="url(#grid)"/>
  <rect width="${W}" height="3" fill="url(#accent)"/>

  <!-- Corner brackets -->
  <path d="M 22 40 L 22 22 L 40 22" fill="none" stroke="${t.accent[1]}" stroke-width="2" opacity="0.6"/>
  <path d="M ${W - 22} 40 L ${W - 22} 22 L ${W - 40} 22" fill="none" stroke="${t.accent[1]}" stroke-width="2" opacity="0.6"/>

  <!-- Status pill -->
  <rect x="${W / 2 - 300}" y="30" width="600" height="28" rx="14" fill="${t.pillBg}" stroke="${t.cardStroke}"/>
  <circle cx="${W / 2 - 278}" cy="44" r="4.5" fill="#10B981"/>
  <circle cx="${W / 2 - 278}" cy="44" r="8" fill="#10B981" opacity="0.25"/>
  <text x="${W / 2 + 10}" y="48.5" text-anchor="middle" fill="${t.muted}" font-family="${FONT}" font-size="11.5" font-weight="600" letter-spacing="1.4">BICT (HONS) UNDERGRADUATE • UNIVERSITY OF RUHUNA • OPEN TO INTERNSHIPS</text>

  <!-- Identity -->
  <text x="${W / 2}" y="110" text-anchor="middle" fill="${t.title}" font-family="${FONT}" font-size="44" font-weight="800" letter-spacing="-1">Mohamed Hajith</text>
  <text x="${W / 2}" y="144" text-anchor="middle" fill="url(#accent)" font-family="${FONT}" font-size="18" font-weight="600">Full-Stack Software Developer | Backend &amp; Database Engineering</text>
  <text x="${W / 2}" y="174" text-anchor="middle" fill="${t.muted}" font-family="${FONT}" font-size="13">${esc(stats)}</text>

  <!-- Section header -->
  <text x="${pad}" y="214" fill="${t.accent[1]}" font-family="${FONT}" font-size="11.5" font-weight="700" letter-spacing="2">FEATURED &amp; LATEST PROJECTS</text>
  <text x="${W - pad}" y="214" text-anchor="end" fill="${t.muted}" font-family="${MONO}" font-size="11">live from github.com/${esc(USER)}</text>
  <rect x="${pad}" y="221" width="${W - pad * 2}" height="1" fill="${t.cardStroke}"/>

  ${cards}

  <text x="${W / 2}" y="${H - 16}" text-anchor="middle" fill="${t.muted}" font-family="${FONT}" font-size="11">Synced ${esc(fmtDay(data.syncedAt))} (UTC) · auto-updated by GitHub Actions</text>
  </g>
</svg>
`;
}

// ─── Main ──────────────────────────────────────────────────────────────────
const data = await loadData();
if (!data.cards.length) throw new Error("No repositories found; refusing to overwrite banners.");

for (const dir of OUT_DIRS) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "dark.svg"), render(THEMES.dark, data), "utf8");
  await writeFile(path.join(dir, "light.svg"), render(THEMES.light, data), "utf8");
  console.log(`Wrote dark.svg + light.svg → ${dir}`);
}
console.log(`Cards: ${data.cards.map((c) => `${c.title} [${c.tag}]`).join(", ")}`);
