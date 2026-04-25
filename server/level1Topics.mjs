/**
 * Level 1: one topic chosen at random per request — Pexels / LoremFlickr
 */
export const TOPICS = {
  hydrant: {
    id: 'hydrant',
    label: 'a fire hydrant',
    pexelsQuery: 'classic red fire hydrant short stout body street curb municipal',
    loremTag: 'fire,hydrant'
  },
  donut: {
    id: 'donut',
    label: 'a donut',
    pexelsQuery: 'round glazed ring doughnut with hole in middle',
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
