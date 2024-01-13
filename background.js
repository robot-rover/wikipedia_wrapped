const dbName = "wikipedia_wrapped";
const beginStoreName = "begin";
const endStoreName = "end";
const locStoreName = "loc";
const dbVer = 1;
const tabKey = 'db_key';

console.log("Loaded Extension");

const DBOpenRequest = indexedDB.open(dbName, dbVer)
const ENABLE_SESSIONS = (browser.sessions !== undefined);
let IS_MOBILE;
browser.runtime.getPlatformInfo().then(platform => {
  IS_MOBILE =(platform.os === 'android');
});

let db;

function promisifyResult(request) {
  return new Promise((resolve, reject) => {
      request.oncomplete = request.onsuccess = () => resolve(request.result);
      request.onabort = request.onerror = () => reject(request.error);
  });
}

function error_fmt(message) {
    return (event) => {
        console.error(message, event, event.stack);
    }
}

function get_location() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(pos => resolve(pos.coords), error_fmt("Unable to get geolocation"));
  });
}

function get_download_page(url) {
  return `
    <style>
      .center {
        margin: 0;
        position: absolute;
        top: 50%;
        left: 50%;
        -ms-transform: translate(-50%, -50%);
        transform: translate(-50%, -50%);
      }

      .dl-btn {
        font-size: 40px;
        padding: 10px;
      }
    </style>

    <div class="center">
      <a href="${url}" download="wikipedia_wrapped.json"><button class="dl-btn">Download</button></a>
    </div>
  `;
}

DBOpenRequest.onerror = error_fmt("Unable to open database");

DBOpenRequest.onsuccess = (event) => {
    console.log("Loaded Database")
    db = DBOpenRequest.result;
}

DBOpenRequest.onupgradeneeded = (event) => {
    console.log(`Loaded Database (Upgrading from ${event.oldVersion} to ${event.newVersion})`)
    db = event.target.result;

    db.onerror = error_fmt("Unable to upgrade database");

    const beginStore = db.createObjectStore(beginStoreName, { keyPath: "id", autoIncrement: true } );
    beginStore.createIndex("title", "title");
    beginStore.createIndex("begin", "begin");
    beginStore.createIndex("parent", "parent");

    const endStore = db.createObjectStore(endStoreName, { keyPath: "id" });
    endStore.createIndex("end", "end");

    const locStore = db.createObjectStore(locStoreName, { keyPath: "id" });
    locStore.createIndex("lat", "lat");
    locStore.createIndex("lon", "lon");
}

function set_loc(key, loc) {
  const transaction = db.transaction([locStoreName], 'readwrite');

  transaction.onerror = error_fmt("loc database transaction failed");
  const locStore = transaction.objectStore(locStoreName);
  return promisifyResult(locStore.add( { id: key, lat: loc.latitude, lon: loc.longitude } )).then((_key) => {
    console.log(`Located page (id ${key}) at lat: ${loc.latitude}, lon: ${loc.longitude}`);
  }, error_fmt("set loc request failed"));
}

function set_begin(pageName, accessTime, parent) {
  const transaction = db.transaction([beginStoreName], 'readwrite');

  transaction.onerror = error_fmt("begin database transaction failed");
  const beginStore = transaction.objectStore(beginStoreName);
  return promisifyResult(beginStore.add( { begin: accessTime.toISOString(), title: pageName, parent: parent } )).then((id) => {
    console.log(`Opened ${pageName} (id ${id}) at ${accessTime.toISOString()} from parent (id ${parent})`);
    return id;
  }, error_fmt("set begin request failed"));
}

function set_end(key, closeTime) {
  const transaction = db.transaction([endStoreName], 'readwrite');
  transaction.onerror = error_fmt("end database transaction failed");

  const endStore = transaction.objectStore(endStoreName);
  return promisifyResult(endStore.add( { end: closeTime.toISOString(), id: key } )).then((_key) => {
    console.log(`Closed page (id ${key}) at ${closeTime.toISOString()}`);
  }, error_fmt('set end request failed'));
}

async function navigate_away(tabId, closeTime) {
  const tabIdStr = tabId.toString();
  const results = await browser.storage.local.get([tabIdStr]);
  if (tabIdStr in results) {
    set_end(results[tabIdStr][0], closeTime);
    await browser.storage.local.remove([tabIdStr]);
    return results[tabIdStr][0];
  } else {
    return null;
  }
}

async function get_all_data() {
  const transaction = db.transaction([beginStoreName, endStoreName, locStoreName], 'readonly');
  transaction.onerror = error_fmt("get all database transaction failed");

  const beginStore = transaction.objectStore(beginStoreName);
  const endStore = transaction.objectStore(endStoreName);
  const locStore = transaction.objectStore(locStoreName);
  const stores = [beginStore, endStore, locStore];

  const data = {};
  const all = stores.map(async store => {
    const storeData = await promisifyResult(store.getAll());
    for (const record of storeData) {
      if (!(record.id in data)) {
        data[record.id] = {};
      }
      const masterRecord = data[record.id];
      for (const [key, value] of Object.entries(record)) {
        if (key === 'id') { continue; }
        masterRecord[key] = value;
      }
    }
  } );
  await Promise.all(all);
  return data;
}

browser.storage.local.get().then((results) => {
  const toRemove = [];
  return browser.tabs.query({}).then((tabs) => {
    const validIds = new Set(tabs.map((tab) => tab.id));
    for (const tabIdStr in results) {
      if(!validIds.has(parseInt(tabIdStr))) {
        toRemove.push(tabIdStr);
      }
    }
    console.log('Removing ', toRemove.length, ' old tab references');
    return browser.storage.local.remove(toRemove);
  });
});

if (ENABLE_SESSIONS) {
  browser.tabs.onCreated.addListener((tab) => {
    browser.sessions.getTabValue(tab.id, tabKey).then((key) => {
      if (key !== undefined) {
        const toSet = Object();
        toSet[tab.id.toString()] = key;
        browser.storage.local.set(toSet);
      }
    });
  });
}

browser.webNavigation.onCompleted.addListener(async evt => {
  // Filter out any sub-frame related navigation event
  console.log('Hello World');
  if (evt.frameId !== 0) {
    return;
  }

  const url = new URL(evt.url);

  let pageName = undefined;
  let isSearch = false;
  if (url.host.endsWith("wikipedia.org")) {
    const match = url.pathname.match(/^\/wiki\/(.+)$/);
    if (match !== null) {
      pageName = match[1];
    } else if (url.pathname === '/w/index.php') {
      searchTerm = url.searchParams.get("search");
      if (searchTerm !== null) {
        pageName = 'search:' + searchTerm;
        isSearch = true;
      }
    }
  }

  const accessTime = new Date();

  const results = await browser.storage.local.get([evt.tabId.toString()]);

  if (evt.tabId in results && results[evt.tabId][1] === pageName) {
    // This tab already existed and was just reloaded
    return;
  }

  let prevKey = await navigate_away(evt.tabId, accessTime);
  if (isSearch) {
    prevKey = null;
  }

  if (pageName === undefined) {
    if (ENABLE_SESSIONS) {
      return await browser.sessions.removeTabValue(evt.tabId, tabKey);
    } else {
      return;
    }
  } else {
    let newKey = await set_begin(pageName, accessTime, prevKey);
    const toSet = Object();
    toSet[evt.tabId.toString()] = [newKey, pageName];
    browser.storage.local.set(toSet);
    if (ENABLE_SESSIONS) {
      browser.sessions.setTabValue(evt.tabId, tabKey, [newKey, pageName]);
    }
    const loc = await get_location();
    set_loc(newKey, loc);
  }
}, {
  url: [{schemes: ["http", "https"]}]
});

browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
  navigate_away(tabId, new Date());
});

let data_url = undefined;
let page_url = undefined;

browser.action.onClicked.addListener(async (tab, onClickData) => {
  const data = await get_all_data();

  if (data_url != undefined) {
    URL.revokeObjectURL(data_url);
  }
  data_url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json', endings: 'native' } ));
  console.log('Data available at ', data_url);

  if (IS_MOBILE) {
    if (page_url != undefined) {
      URL.revokeObjectURL(page_url);
    }
    page_url = URL.createObjectURL(new Blob([get_download_page(data_url)]));
    browser.tabs.create({active: true, url: page_url});
  } else {
    browser.downloads.download({ url: data_url, filename: 'wikipedia_wrapped.json' }).then(
      (_downloadId) => {
        console.log('Download Started');
      },
      () => {
        console.log('Download Canceled');
      }
    );
  }
});