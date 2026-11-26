// google.js: thin wrappers around Google Places API (New)
import { GOOGLE_API_KEY } from "./config.js";

const PLACES = "https://places.googleapis.com/v1";

// Suggestions for what the user has typed so far.
// Returns [{ placeId, main, mainMatches, secondary }]
// mainMatches: [{ start, end }] character ranges of `main` that matched the input
export async function autocompletePlaces(input, sessionToken, signal) {
  const res = await fetch(`${PLACES}/places:autocomplete`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_API_KEY,
    },
    body: JSON.stringify({ input, sessionToken, includedRegionCodes: ["us"] }),
  });
  if (!res.ok) throw new Error(`Autocomplete failed: ${res.status} ${await res.text()}`);

  const { suggestions = [] } = await res.json();
  return suggestions
    .map(s => s.placePrediction)
    .filter(Boolean)
    .map(p => {
      const main = p.structuredFormat?.mainText ?? p.text ?? {};
      return {
        placeId:     p.placeId,
        main:        main.text ?? "",
        mainMatches: (main.matches ?? []).map(m => ({ start: m.startOffset ?? 0, end: m.endOffset })),
        secondary:   p.structuredFormat?.secondaryText?.text ?? "",
      };
    });
}

// Full address for a chosen suggestion. Passing the same sessionToken
// ends the autocomplete session (Google bills the session as one request).
export async function placeDetails(placeId, sessionToken) {
  const url = `${PLACES}/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`;
  const res = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": GOOGLE_API_KEY,
      "X-Goog-FieldMask": "displayName,formattedAddress",
    },
  });
  if (!res.ok) throw new Error(`Place details failed: ${res.status} ${await res.text()}`);

  const p = await res.json();
  return { name: p.displayName?.text ?? "", address: p.formattedAddress ?? "" };
}

// ---------- Routes API ----------
const ROUTES = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";

// Driving time/distance for every origin → destination pair, using current traffic.
// Returns a grid: result[originIndex][destinationIndex] = { seconds, meters } or null (no route).
export async function driveMatrix(origins, destinations, signal) {
  const toWaypoint = (address) => ({ waypoint: { address } });
  const res = await fetch(ROUTES, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_API_KEY,
      "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,status,condition",
    },
    body: JSON.stringify({
      origins: origins.map(toWaypoint),
      destinations: destinations.map(toWaypoint),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
    }),
  });
  if (!res.ok) throw new Error(`Route matrix failed: ${res.status} ${await res.text()}`);

  const grid = origins.map(() => destinations.map(() => null));
  for (const el of await res.json()) {
    const ok = el.condition === "ROUTE_EXISTS" && !el.status?.code;
    if (!ok) continue;
    grid[el.originIndex ?? 0][el.destinationIndex ?? 0] = {
      seconds: parseInt(el.duration, 10),   // duration comes back like "1534s"
      meters:  el.distanceMeters ?? 0,
    };
  }
  return grid;
}
