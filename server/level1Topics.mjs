/**
 * Level 1: one topic chosen at random per request — Pexels / LoremFlickr
 */
export const TOPICS = {
  hydrant: {
    id: 'hydrant',
    label: 'a fire hydrant',
    pexelsQuery: 'red fire hydrant full view clear photo sharp focus entire hydrant in frame front daylight unobstructed',
    loremTag: 'fire,hydrant'
  },
  donut: {
    id: 'donut',
    label: 'a donut',
    pexelsQuery: 'classic glazed ring doughnut top view center hole round torus shape bakery',
    loremTag: 'doughnut,glazed'
  },
  traffic_light: {
    id: 'traffic_light',
    label: 'a traffic light',
    pexelsQuery: 'traffic light red green yellow amber stoplight',
    loremTag: 'stoplight,signal'
  }
};

export const TOPIC_IDS = Object.keys(TOPICS);

export function getTopic(missionId) {
  return TOPICS[missionId] || null;
}
