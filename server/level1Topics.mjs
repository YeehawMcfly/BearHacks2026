/**
 * Level 1 challenge topics: fixed allowlist (labels + Pexels / LoremFlickr tags)
 */
export const TOPICS = {
  hydrant: {
    id: 'hydrant',
    label: 'a fire hydrant',
    pexelsQuery: 'fire hydrant',
    loremTag: 'fire,hydrant'
  },
  donut: {
    id: 'donut',
    label: 'a donut',
    pexelsQuery: 'donut pastry',
    loremTag: 'donut'
  },
  traffic: {
    id: 'traffic',
    label: 'a traffic light',
    pexelsQuery: 'traffic light',
    loremTag: 'traffic,light'
  }
};

export const TOPIC_IDS = Object.keys(TOPICS);

export function getTopic(missionId) {
  return TOPICS[missionId] || null;
}
