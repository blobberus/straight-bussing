// Real feed pattern for the ETA tests (core-eta.js, route-eta.js): Passio tripUpdates + vehiclePositions of Fri Nov 20 2026
// 12:37 PM (feed timestamp T0), cut to three lines: 53rd Street Express (4346: trip 681004 = one head + 13 filler entries
// at +2 s), Apostolic/Drexel (6126: two buses, filler runs between real times, a head listed out of travel order) and Red
// Line/Arts Block (5699: no trip update at all; its bus is added here as it was seen later that hour, heading to Logan
// Center for Arts). Times are T0 + seconds; current_stop_sequence as Passio sent it; stop data from web/data
// (route_stops, stops, segments).
import { createPredict } from "../js/core/predict.js";

export const T0 = 1795199837;
export const routeStops = {"4346": ["8596", "8811", "8628", "8595", "8629", "138837", "8630", "8612", "8589", "8631", "8632", "161844", "8594", "8624", "8599", "8626", "8596"], "6126": ["8612", "8613", "8615", "8616", "8617", "8609", "8630", "8611", "8614", "133007", "8612"], "5699": ["67598", "67599", "8650", "67600", "67601", "161393", "67602", "69624", "161392", "67603", "138836", "67598"]};
export const stops = {
  "8589": {"name": "Logan Center", "lat": 41.78585, "lon": -87.60376},
  "8594": {"name": "Press Building", "lat": 41.78604, "lon": -87.59018},
  "8595": {"name": "Ellis & 53rd St.", "lat": 41.79912, "lon": -87.60138},
  "8596": {"name": "Harper Court (NE Corner)", "lat": 41.79965, "lon": -87.588},
  "8599": {"name": "57th St. & Metra (NB)", "lat": 41.79139, "lon": -87.58659},
  "8609": {"name": "57th Street & Drexel (NB)", "lat": 41.79131, "lon": -87.60367},
  "8611": {"name": "Drexel Garage", "lat": 41.78443, "lon": -87.60444},
  "8612": {"name": "Goldblatt Pavilion", "lat": 41.78774, "lon": -87.60361},
  "8613": {"name": "Wyler Pavilion", "lat": 41.7888, "lon": -87.60487},
  "8614": {"name": "Apostolic Lot", "lat": 41.77961, "lon": -87.59301},
  "8615": {"name": "Bernard Mitchell Hospital", "lat": 41.78943, "lon": -87.60487},
  "8616": {"name": "58th Street & Drexel", "lat": 41.78951, "lon": -87.60392},
  "8617": {"name": "Comer Children's Hospital", "lat": 41.79051, "lon": -87.60365},
  "8624": {"name": "Stony Island Parking Lot", "lat": 41.78633, "lon": -87.58739},
  "8626": {"name": "Lake Park & 55th St. (SE Corner)", "lat": 41.79506, "lon": -87.58745},
  "8628": {"name": "Kimbark Plaza (NE Corner)", "lat": 41.79953, "lon": -87.5965},
  "8629": {"name": "Ellis Garage & Ratner Athletic (West)", "lat": 41.79463, "lon": -87.60148},
  "8630": {"name": "Levi Hall (W)", "lat": 41.78966, "lon": -87.6013},
  "8631": {"name": "60th St. & Ellis (SE Corner)", "lat": 41.78583, "lon": -87.60109},
  "8632": {"name": "60th St. & Woodlawn Ave (SE Corner)", "lat": 41.78594, "lon": -87.59653},
  "8650": {"name": "Ellis/57th", "lat": 41.79129, "lon": -87.60125},
  "8811": {"name": "53rd St & Kenwood", "lat": 41.79955, "lon": -87.59251},
  "67598": {"name": "Logan Center for Arts", "lat": 41.78586, "lon": -87.6038},
  "67599": {"name": "Institute for Study of Ancient Cultures", "lat": 41.78956, "lon": -87.60124},
  "67600": {"name": "Smart Museum of Arts", "lat": 41.79412, "lon": -87.60125},
  "67601": {"name": "Garfield Green Line Station", "lat": 41.79494, "lon": -87.61833},
  "67602": {"name": "Garfield Red Line Station (WB)", "lat": 41.79467, "lon": -87.63111},
  "67603": {"name": "Washington Park Arts Incubator", "lat": 41.79439, "lon": -87.6182},
  "69624": {"name": "Garfield Red Line Station (EB)", "lat": 41.79416, "lon": -87.63123},
  "133007": {"name": "Kenwood & 63rd", "lat": 41.78087, "lon": -87.5929},
  "138836": {"name": "Midway Plaisance & Cottage Grove", "lat": 41.78635, "lon": -87.60624},
  "138837": {"name": "Ellis Ave & 57th St", "lat": 41.79145, "lon": -87.60134},
  "161392": {"name": "Garfield & Wabash (EB)", "lat": 41.79424, "lon": -87.62365},
  "161393": {"name": "Garfield & Wabash (WB)", "lat": 41.79478, "lon": -87.62367},
  "161844": {"name": "Keller Center EB", "lat": 41.78598, "lon": -87.59403},
};
export const segments = { v: 1, routes: {"4346": {"seg": [60, 60, 120, 120, 60, 60, 120, 120, 60, 60, 60, 60, 60, 120, 120, 240], "dwell": 0, "hw": 30.0}, "6126": {"seg": [63, 20, 27, 35, 29, 109, 239, 475, 40, 463], "hw": 10.0}, "5699": {"seg": [79, 24, 40, 208, 56, 78, 43, 80, 57, 202, 33], "dwell": 0, "hw": 10.0}} };
const u = (seq, id, dt) => ({ stop_sequence: seq, stop_id: id, arrival: { time: T0 + dt }, departure: { time: T0 + dt } });
/** The trip updates of the three lines, as Passio sent them (listed order kept; nothing marked). */
export const tripUpdates = () => [
  { trip: {"trip_id": "675900", "route_id": "6126"}, vehicle: {"id": "4317", "label": "1651"}, stop_time_update: [u(13, "8612", -38)] },
  { trip: {"trip_id": "675901", "route_id": "6126"}, vehicle: {"id": "4317", "label": "1651"}, stop_time_update: [u(1, "8612", 24), u(2, "8613", 26), u(3, "8615", 636), u(4, "8616", 638), u(5, "8617", 668), u(6, "8609", 704), u(7, "8630", 778), u(8, "8611", 909), u(10, "8614", 1044), u(11, "133007", 1324), u(12, "225833", 1326)] },
  { trip: {"trip_id": "501469", "route_id": "6126"}, vehicle: {"id": "4318", "label": "1652"}, stop_time_update: [u(1, "8612", 183), u(2, "8613", 185), u(3, "8615", 187), u(4, "8616", 189), u(5, "8617", 191), u(6, "8609", 193), u(7, "8630", 195), u(8, "8611", 197), u(10, "8614", 199), u(11, "133007", 457), u(12, "225833", 459), u(13, "8612", 461)] },
  { trip: {"trip_id": "681004", "route_id": "4346"}, vehicle: {"id": "4326", "label": "134"}, stop_time_update: [u(1, "8596", 752), u(2, "8811", 754), u(3, "8628", 756), u(7, "8630", 758), u(8, "8612", 760), u(9, "8589", 762), u(10, "8631", 764), u(11, "8632", 766), u(12, "161844", 768), u(13, "8594", 770), u(14, "8624", 772), u(15, "8599", 774), u(16, "8626", 776), u(17, "8596", 778)] },
  { trip: {"trip_id": "681005", "route_id": "4346"}, vehicle: {"id": "4326", "label": "134"}, stop_time_update: [u(4, "8595", 1586)] },
];
/** The vehicles of the three lines (timestamps T0 + seconds). */
export const vehicles = () => [
  { trip: {"trip_id": "681004", "route_id": "4346"}, vehicle: {"id": "4326", "label": "134"}, current_stop_sequence: 5, stop_id: "8629", timestamp: T0 + 0, position: { latitude: 41.795507333, longitude: -87.601243 } },
  { trip: {"trip_id": "675900", "route_id": "6126"}, vehicle: {"id": "4317", "label": "1651"}, current_stop_sequence: 13, stop_id: "8612", timestamp: T0 + -3, position: { latitude: 41.7876971, longitude: -87.6022988 } },
  { trip: {"trip_id": "501469", "route_id": "6126"}, vehicle: {"id": "4318", "label": "1652"}, current_stop_sequence: 8, stop_id: "8611", timestamp: T0 + -4, position: { latitude: 41.7865916, longitude: -87.6012145 } },
  { trip: {"trip_id": "504011", "route_id": "5699"}, vehicle: {"id": "4325", "label": "1659"}, current_stop_sequence: 1, stop_id: "67598", timestamp: T0 - 2, position: { latitude: 41.7864, longitude: -87.6053 } },
];
/** Scheduled riding minutes between two stops of a route (core/predict.js on the segments above), or null. */
const P = createPredict({ segments, routeStops });
export const ride = (rid, a, b) => P.rideMinutes(rid, a, b).min;
