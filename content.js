// content.js runs inside the listing page and looks for the apartment's address
(() => {
  const ADDRESS_RE = /\d{1,6}[^\S\n]+[\w .#-]+,[^\S\n]*[A-Za-z ]+,[^\S\n]*[A-Z]{2}[^\S\n]*\d{5}/;

  // Shorthand: get trimmed text for a selector, or null
  const text = (sel, root = document) => root.querySelector(sel)?.innerText?.trim() || null;

  // 0. Site-specific extractors: each returns an address string or null
  const SITE_EXTRACTORS = {
    "zillow.com": () =>
      text('[data-test-id="bdp-building-address"]'),

    "apartments.com": () => {
      const row = document.querySelector("#propertyAddressRow");
      if (!row) return null;

      const street = text(".delivery-address h1", row);
      const city   = text("h2 > span:first-child", row);
      const [state, zip] = [...row.querySelectorAll(".stateZipContainer span")]
        .map(s => s.innerText.trim());

      if (!street || !city) return null;
      return `${street}, ${city}, ${state ?? ""} ${zip ?? ""}`.trim();
    },
  };

  const host = location.hostname.replace(/^www\./, "");
  const extractor = SITE_EXTRACTORS[host];
  if (extractor) {
    try {
      const address = extractor();
      if (address) return { address, source: `site: ${host}` };
    } catch (e) {
      console.warn("Site extractor failed, falling back:", e);
    }
  }


// 0.5 Google Maps links on the page (works on many sites)
  for (const link of document.querySelectorAll('a[href*="google.com/maps"], a[href*="maps.google.com"]')) {
    try {
      const url = new URL(link.href);
      // ?daddr=... / ?destination=... / ?q=... styles
      let addr = url.searchParams.get("daddr")
              ?? url.searchParams.get("destination")
              ?? url.searchParams.get("q");
      // /maps/dir//ADDRESS or /maps/place/ADDRESS styles
      if (!addr) {
        const m = url.pathname.match(/\/maps\/(?:dir\/[^/]*\/|place\/)([^/]+)/);
        if (m) addr = m[1];
      }
      if (addr) {
        addr = decodeURIComponent(addr.replace(/\+/g, " ")).trim();
        if (addr.length > 5) return { address: addr, source: "google maps link" };
      }
    } catch {}
  }

    // 1. JSON-LD structured data
  const formatAddress = (a) => {
    if (!a) return null;
    if (typeof a === "string") return a.trim();          // some sites put the address in as one string
    if (Array.isArray(a)) return formatAddress(a[0]);    // some list several addresses

    const region = typeof a.addressRegion === "object" ? a.addressRegion?.name : a.addressRegion;
    const stateZip = [region, a.postalCode].filter(Boolean).join(" ");

    return [a.streetAddress, a.addressLocality, stateZip]
      .map(part => part?.toString().trim())
      .filter(Boolean)          // drops undefined, null and empty strings
      .join(", ") || null;
  };

  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent);
      // Some sites nest their items inside an "@graph" array
      const items = [data].flat().flatMap(d => d?.["@graph"] ?? [d]);
      for (const item of items) {
        const address = formatAddress(item?.address);
        if (address && /\d/.test(address)) {   // needs at least a house number
          return { address, source: "json-ld" };
        }
      }
    } catch {}
  }

  // 2. Title and meta tags
  for (const t of [
    document.title,
    document.querySelector('meta[property="og:title"]')?.content,
    document.querySelector('meta[name="description"]')?.content,
    text("h1")
  ]) {
    const m = t?.match(ADDRESS_RE);
    if (m) return { address: m[0], source: "meta/title" };
  }

  // 3. Visible page text
  const m = document.body.innerText.match(ADDRESS_RE);
  if (m) return { address: m[0], source: "page text" };

  return null;
})();