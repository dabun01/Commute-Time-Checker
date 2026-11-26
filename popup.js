const addressInput = document.getElementById("address");
const sourceLabel  = document.getElementById("source");

try {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"]
  });

  const found = result ?? addressFromUrl(tab.url);
  console.log("Found:", found);

  if (found?.address) {
    addressInput.value = found.address;
    sourceLabel.textContent = `Found via ${found.source}`;
  } else if (found?.query) {
    addressInput.value = found.query;
    sourceLabel.textContent = "Building name only. Check the address before searching.";
  } else {
    addressInput.placeholder = "No address found. Type one in.";
  }
  // Let places.js know the address is ready so it can fetch drive times
  addressInput.dispatchEvent(new Event("change"));
} catch (err) {
  console.error(err);
  addressInput.placeholder = "Can't read this page. Type an address.";
}

function addressFromUrl(url) {
  const u = new URL(url);
  const home = u.pathname.match(/\/homedetails\/([^/]+)\//);
  if (home) return { address: home[1].replace(/-/g, " "), source: "url" };

  const bldg = u.pathname.match(/\/apartments\/([a-z-]+)-([a-z]{2})\/([^/]+)\//);
  if (bldg) {
    return { query: `${bldg[3].replace(/-/g, " ")}, ${bldg[1].replace(/-/g, " ")} ${bldg[2].toUpperCase()}` };
  }
  return null;
}