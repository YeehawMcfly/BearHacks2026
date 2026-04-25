/**
 * Level 1: single topic for now (fire hydrant) — Pexels / LoremFlickr
 */
export const TOPICS = {
  hydrant: {
    id: 'hydrant',
    label: 'a fire hydrant',
    pexelsQuery: 'red yellow fire hydrant on sidewalk',
    loremTag: 'fire,hydrant'
  }
};

export const TOPIC_IDS = Object.keys(TOPICS);

export function getTopic(missionId) {
  return TOPICS[missionId] || null;
}
