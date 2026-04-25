import { getTopic } from './level1Topics.mjs';

const NEGATIVE_QUERIES = [
  'mountain landscape',
  'ocean beach',
  'forest path',
  'laptop computer',
  'pizza food',
  'cat pet',
  'basketball court'
];

function shuffleInPlace(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/**
 * LoremFlickr: comma-separated tags in path, lock gives stable-but-distinct image per id.
 */
function loremFlickrUrl(tagComma, lock) {
  return `https://loremflickr.com/200/200/${tagComma}?lock=${lock}`;
}

const NEG_Lorem_TAGS = [
  'mountain,nature',
  'beach,ocean',
  'forest,tree',
  'laptop,computer',
  'pizza,food',
  'cat,animal',
  'flower,rose'
];

/**
 * @param {string} query
 * @param {number} want
 * @param {string} key
 * @returns {Promise<string[]>}
 */
async function pexelsSearchUrls(query, want, key) {
  if (!key || want <= 0) return [];
  const u = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=40&size=small`;
  const r = await fetch(u, { headers: { Authorization: key } });
  if (!r.ok) return [];
  const j = await r.json();
  const out = [];
  const seen = new Set();
  for (const p of j.photos || []) {
    const src = p.src?.small || p.src?.medium || p.src?.tiny;
    if (src && !seen.has(src)) {
      seen.add(src);
      out.push(src);
      if (out.length >= want) break;
    }
  }
  return out;
}

/**
 * @param {string} missionId
 * @param {string|undefined} pexelsKey
 * @returns {Promise<null | { missionId: string, label: string, imageUrls: string[], correctIndices: number[] }>}
 */
export async function buildLevel1Remote(missionId, pexelsKey) {
  const topic = getTopic(missionId);
  if (!topic) return null;

  const kPos = 1 + Math.floor(Math.random() * 5);
  const nNeg = 9 - kPos;

  let posUrls = [];
  let negUrls = [];

  if (pexelsKey) {
    posUrls = await pexelsSearchUrls(topic.pexelsQuery, kPos, pexelsKey);
    const negQ = NEGATIVE_QUERIES[Math.floor(Math.random() * NEGATIVE_QUERIES.length)];
    negUrls = await pexelsSearchUrls(negQ, nNeg, pexelsKey);
  }

  const lock0 = (Date.now() % 200000) + Math.floor(Math.random() * 1000);
  let p = 0;
  while (posUrls.length < kPos) {
    posUrls.push(loremFlickrUrl(topic.loremTag, lock0 + p * 17));
    p += 1;
  }
  let q = 0;
  while (negUrls.length < nNeg) {
    const tag = NEG_Lorem_TAGS[(q + missionId.length) % NEG_Lorem_TAGS.length];
    negUrls.push(loremFlickrUrl(tag, lock0 + 500 + q * 19));
    q += 1;
  }

  posUrls = posUrls.slice(0, kPos);
  negUrls = negUrls.slice(0, nNeg);

  const tiles = [
    ...posUrls.map((url) => ({ url, isPositive: true })),
    ...negUrls.map((url) => ({ url, isPositive: false }))
  ];
  shuffleInPlace(tiles);

  const imageUrls = tiles.map((t) => t.url);
  const correctIndices = [];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i].isPositive) correctIndices.push(i);
  }

  return {
    missionId: topic.id,
    label: topic.label,
    imageUrls,
    correctIndices
  };
}
