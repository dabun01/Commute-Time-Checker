import { autocompletePlaces, placeDetails, driveMatrix } from "./google.js";

// places.js: saved places (work, church, ...) stored in chrome.storage.sync
const ICONS = ["🏢", "⛪", "🏠", "🎓", "🏋️", "🛒", "❤️", "📍"];

const list      = document.getElementById("place-list");
const emptyMsg  = document.getElementById("places-empty");
const addBtn    = document.getElementById("add-place");
const form      = document.getElementById("place-form");
const nameIn    = document.getElementById("place-name");
const addrIn    = document.getElementById("place-address");
const iconPick  = document.getElementById("icon-picker");
const cancelBtn = document.getElementById("place-cancel");
const suggestBox = document.getElementById("place-suggestions");
const aptInput  = document.getElementById("address");   // apartment address (filled by popup.js)

let places = [];
let editingId = null;   // null = adding a new place

const save = () => chrome.storage.sync.set({ places });

// ---------- rendering ----------
function render() {
  // Shortest drive to the place first; places without a time keep their saved order at the end
  const toSecs = (p) => commuteFor(p)?.to?.seconds ?? Infinity;
  const sorted = [...places].sort((a, b) => toSecs(a) - toSecs(b));
  list.replaceChildren(...sorted.map(pillFor));
  emptyMsg.hidden = places.length > 0 || !form.hidden;
}

function pillFor(place) {
  const li = document.createElement("li");
  li.className = "pill";
  li.title = place.address;

  // Top row: icon, name, distance, edit, delete
  const head = document.createElement("div");
  head.className = "pill-head";

  const icon = document.createElement("span");
  icon.className = "pill-icon";
  icon.textContent = place.icon;

  const name = document.createElement("span");
  name.className = "pill-name";
  name.textContent = place.name;

  const commute = commuteFor(place);
  const distance = document.createElement("span");
  distance.className = "pill-distance";
  distance.textContent = commute?.to ? formatMiles(commute.to.meters) : "";

  const edit = iconButton("edit", `Edit ${place.name}`, EDIT_SVG, () => openForm(place));
  const del  = iconButton("delete", `Delete ${place.name}`, DELETE_SVG, () => {
    places = places.filter(p => p.id !== place.id);
    save();
    render();
  });

  head.append(icon, name, distance, edit, del);
  li.append(head);

  // Bottom row: TO / FROM drive times (only once there's an apartment address)
  if (commute) li.append(timesRow(commute));
  return li;
}

function timesRow(commute) {
  const row = document.createElement("div");
  row.className = "pill-times";
  for (const [label, leg] of [["TO", commute.to], ["FROM", commute.from]]) {
    const block = document.createElement("div");
    block.className = "time-block";

    const l = document.createElement("span");
    l.className = "time-label";
    l.textContent = `${label}:`;

    const v = document.createElement("span");
    v.className = "time-value";
    if (commute.loading) {
      v.textContent = "…";
      v.classList.add("pending");
    } else if (leg) {
      v.textContent = formatDuration(leg.seconds);
    } else {
      v.textContent = commute.error ? "Error" : "No route";
      v.classList.add("pending");
      if (commute.error) v.title = commute.error;
    }
    block.append(l, v);
    row.append(block);
  }
  return row;
}

// ---------- drive times (Google Routes) ----------
// Cache by "apartment|place" so editing one place doesn't refetch the rest
const commuteCache = new Map();
const LOADING = { loading: true };
const cacheKey = (place) => `${aptInput.value.trim()}|${place.address}`;

function commuteFor(place) {
  if (!aptInput.value.trim()) return null;
  return commuteCache.get(cacheKey(place)) ?? LOADING;
}

async function refreshCommutes() {
  const apt = aptInput.value.trim();
  const missing = apt ? places.filter(p => !commuteCache.has(cacheKey(p))) : [];
  render();
  if (!missing.length) return;

  // Both directions for every missing place: 2 requests total
  const addresses = [...new Set(missing.map(p => p.address))];
  try {
    const [toGrid, fromGrid] = await Promise.all([
      driveMatrix([apt], addresses),   // apartment → each place
      driveMatrix(addresses, [apt]),   // each place → apartment
    ]);
    addresses.forEach((addr, i) => {
      commuteCache.set(`${apt}|${addr}`, { to: toGrid[0][i], from: fromGrid[i][0] });
    });
  } catch (err) {
    console.error(err);
    for (const addr of addresses) commuteCache.set(`${apt}|${addr}`, { error: err.message });
  }
  render();
}

function formatDuration(seconds) {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

function formatMiles(meters) {
  const mi = meters / 1609.344;
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}

// popup.js fires "change" after it auto-fills the address; users fire it on Enter/blur
aptInput.addEventListener("change", refreshCommutes);

function iconButton(cls, label, svg, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `pill-btn ${cls}`;
  b.setAttribute("aria-label", label);
  b.title = label;
  b.innerHTML = svg;   // static SVG only, never user data
  b.addEventListener("click", onClick);
  return b;
}

// ---------- icon picker ----------
function buildIconPicker() {
  for (const emoji of ICONS) {
    const label = document.createElement("label");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "place-icon";
    radio.value = emoji;
    const span = document.createElement("span");
    span.textContent = emoji;
    label.append(radio, span);
    iconPick.append(label);
  }
}

const selectIcon = (emoji) => {
  for (const r of iconPick.querySelectorAll("input")) r.checked = r.value === emoji;
};
const selectedIcon = () => iconPick.querySelector("input:checked")?.value ?? ICONS[0];

// ---------- add / edit form ----------
function openForm(place = null) {
  editingId = place?.id ?? null;
  nameIn.value = place?.name ?? "";
  addrIn.value = place?.address ?? "";
  selectIcon(place?.icon ?? ICONS[0]);
  form.querySelector("legend").textContent = place ? "Edit place" : "New place";
  form.hidden = false;
  addBtn.hidden = true;
  resetAutocomplete();
  render();
  nameIn.focus();
}

function closeForm() {
  resetAutocomplete();
  form.hidden = true;
  addBtn.hidden = false;
  editingId = null;
  render();
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const data = {
    name: nameIn.value.trim(),
    address: addrIn.value.trim(),
    icon: selectedIcon(),
  };
  if (!data.name || !data.address) return;

  if (editingId) {
    places = places.map(p => (p.id === editingId ? { ...p, ...data } : p));
  } else {
    places.push({ id: crypto.randomUUID(), ...data });
  }
  save();
  closeForm();
  refreshCommutes();
});

cancelBtn.addEventListener("click", closeForm);
addBtn.addEventListener("click", () => openForm());

// ---------- name autocomplete (Google Places) ----------
let suggestions = [];
let active = -1;            // highlighted suggestion index
let sessionToken = null;    // groups keystrokes + final pick into one billed session
let debounceTimer = null;
let inflight = null;        // AbortController for the latest request

function resetAutocomplete() {
  clearTimeout(debounceTimer);
  inflight?.abort();
  sessionToken = null;
  hideSuggestions();
}

function hideSuggestions() {
  suggestions = [];
  active = -1;
  suggestBox.hidden = true;
  suggestBox.replaceChildren();
  nameIn.setAttribute("aria-expanded", "false");
}

function showStatus(message) {
  const li = document.createElement("li");
  li.className = "status";
  li.textContent = message;
  suggestBox.replaceChildren(li);
  suggestBox.hidden = false;
}

function renderSuggestions() {
  suggestBox.replaceChildren(...suggestions.map((s, i) => {
    const li = document.createElement("li");
    li.id = `suggestion-${i}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(i === active));

    const pin = document.createElement("span");
    pin.className = "pin";
    pin.innerHTML = PIN_SVG;   // static SVG only

    const text = document.createElement("span");
    text.className = "text";
    const main = document.createElement("span");
    main.className = "main";
    main.append(...highlight(s.main, s.mainMatches));
    const secondary = document.createElement("span");
    secondary.className = "secondary";
    secondary.textContent = s.secondary;
    text.append(main, " ", secondary);

    li.append(pin, text);

    // mousedown (not click) so the input's blur doesn't close the list first
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      choose(i);
    });
    return li;
  }));
  suggestBox.hidden = suggestions.length === 0;
  nameIn.setAttribute("aria-expanded", String(suggestions.length > 0));
  if (active >= 0) nameIn.setAttribute("aria-activedescendant", `suggestion-${active}`);
  else nameIn.removeAttribute("aria-activedescendant");
}

// Split text into plain and <b> nodes using Google's match ranges
function highlight(text, matches = []) {
  const nodes = [];
  let pos = 0;
  for (const { start, end } of [...matches].sort((a, b) => a.start - b.start)) {
    if (end == null || start < pos) continue;
    if (start > pos) nodes.push(document.createTextNode(text.slice(pos, start)));
    const b = document.createElement("b");
    b.textContent = text.slice(start, end);
    nodes.push(b);
    pos = end;
  }
  if (pos < text.length) nodes.push(document.createTextNode(text.slice(pos)));
  return nodes;
}

const PIN_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
  <path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>`;

async function fetchSuggestions(query) {
  inflight?.abort();
  inflight = new AbortController();
  sessionToken ??= crypto.randomUUID();
  try {
    const results = await autocompletePlaces(query, sessionToken, inflight.signal);
    if (nameIn.value.trim() !== query) return;   // user kept typing
    suggestions = results;
    active = -1;
    if (results.length) renderSuggestions();
    else showStatus("No matching places");
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error(err);
    showStatus("Couldn't load suggestions");
  }
}

async function choose(i) {
  const s = suggestions[i];
  if (!s) return;
  hideSuggestions();
  nameIn.value = s.main;
  addrIn.value = "";
  addrIn.placeholder = "Looking up address…";
  try {
    const details = await placeDetails(s.placeId, sessionToken);
    addrIn.value = details.address || [s.main, s.secondary].filter(Boolean).join(", ");
  } catch (err) {
    console.error(err);
    addrIn.value = [s.main, s.secondary].filter(Boolean).join(", ");
  } finally {
    sessionToken = null;   // session ends once a place is picked
    addrIn.placeholder = "123 Main St, City, ST 12345";
  }
}

nameIn.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  const query = nameIn.value.trim();
  if (query.length < 2) {
    inflight?.abort();
    hideSuggestions();
    return;
  }
  debounceTimer = setTimeout(() => fetchSuggestions(query), 250);
});

nameIn.addEventListener("keydown", (e) => {
  if (suggestBox.hidden || !suggestions.length) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const step = e.key === "ArrowDown" ? 1 : -1;
    active = (active + step + suggestions.length) % suggestions.length;
    renderSuggestions();
  } else if (e.key === "Enter" && active >= 0) {
    e.preventDefault();          // pick the suggestion instead of submitting the form
    choose(active);
  } else if (e.key === "Escape") {
    e.preventDefault();          // close the list, not the whole popup
    hideSuggestions();
  }
});

nameIn.addEventListener("blur", hideSuggestions);

// ---------- icons ----------
const EDIT_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
  <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
const DELETE_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
  <path fill="currentColor" d="M9 3h6l1 1h4v2H4V4h4l1-1zM6 8h12l-1 12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 8zm4 3v8h1.5v-8H10zm2.5 0v8H14v-8h-1.5z"/></svg>`;

// ---------- init ----------
buildIconPicker();
({ places = [] } = await chrome.storage.sync.get("places"));
refreshCommutes();
