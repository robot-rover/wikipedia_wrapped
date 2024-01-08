// Load existent stats with the storage API.
let gettingStoredStats = browser.storage.local.get();

gettingStoredStats.then(results => {
  // Initialize the saved stats if not yet initialized.
  if (!results.list) {
    results = {
      list: []
    };
  }

  browser.webNavigation.onCompleted.addListener(evt => {
    // Filter out any sub-frame related navigation event
    if (evt.frameId !== 0) {
      return;
    }

    const url = new URL(evt.url);

    if (!url.host.endsWith("wikipedia.org")) {
        return;
    }

    const match = url.pathname.match(/^\/wiki\/(.+)$/);
    if (match === null) {
        return;
    }

    const pageName = match[1];
    const accessTime = new Date().toISOString();

    results.list.push([pageName, accessTime])

    console.log(results);

    // Persist the updated stats.
    browser.storage.local.set(results);
  }, {
    url: [{schemes: ["http", "https"]}]});
});