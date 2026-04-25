/**
 * Level 1 challenge topics: fixed allowlist (labels + Pexels / LoremFlickr tags)
 */
export const TOPICS = {
  hydrant: {
    id: 'hydrant',
    label: 'a fire hydrant',
    pexelsQuery: 'red yellow fire hydrant on sidewalk',
    loremTag: 'fire,hydrant'
  },
  donut: {
    id: 'donut',
    label: 'a donut',
    pexelsQuery: 'round frosted sprinkles donuts bakery',
    loremTag: 'donut,dessert'
  },
  traffic: {
    id: 'traffic',
    label: 'a traffic light',
    pexelsQuery: 'vertical traffic light red green yellow day',
    loremTag: 'traffic,light'
  }
};

export const TOPIC_IDS = Object.keys(TOPICS);

export function getTopic(missionId) {
  return TOPICS[missionId] || null;
}
