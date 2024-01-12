const dbName = "wikipedia_wrapped";
const storeName = "history";
const storeVer = 1;
const tabKey = 'db_key';

console.log("Loaded Extension");

const DBOpenRequest = indexedDB.open(dbName, storeVer)
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
  return `<a href="${url}" download="wikipedia_wrapped.json"><button>Download</button></a>`
}

DBOpenRequest.onerror = error_fmt("Unable to open database");

DBOpenRequest.onsuccess = (event) => {
    console.log("Loaded Database")
    db = DBOpenRequest.result;
}

DBOpenRequest.onupgradeneeded = (event) => {
    console.log("Loaded Database (Upgrading...)")
    db = event.target.result;

    db.onerror = error_fmt("Unable to upgrade database");

    const objectStore = db.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true});
    objectStore.createIndex("title", "title", { unique: false });
    objectStore.createIndex("time", "time", { unique: false });
    objectStore.createIndex("dur", "dur", { unique: false });
    // objectStore.createIndex("lat", "lat", { unique: false });
    // objectStore.createIndex("lon", "lon", { unique: false });
    objectStore.createIndex("parent", "parent", { unique: false });
}

function add_record(pageName, accessTime, parent) {
  const transaction = db.transaction([storeName], 'readwrite');

  transaction.onerror = error_fmt("Database transaction failed");
  const objectStore = transaction.objectStore(storeName);
  return promisifyResult(objectStore.add( { time: accessTime.toISOString(), title: pageName, dur: 0, parent: parent } )).then((id) => {
    console.log('Opened ', pageName, ' (id ', id,  ') at ', accessTime.toISOString());
    return id;
  }, error_fmt("Object store add request failed"));
}

function set_close(key, closeTime) {
  const transaction = db.transaction([storeName], 'readwrite');
  transaction.onerror = error_fmt("Database transaction failed");

  const objectStore = transaction.objectStore(storeName);
  return promisifyResult(objectStore.get( key )).then((record) => {
    if (record === undefined) {
      console.log('Warn: attempted to close page that does not exist (id: ', key.toString(), ')');
      return false;
    }
    record.dur = (closeTime - new Date(record.time)) / 1000;
    return promisifyResult(objectStore.put(record)).then((_key) => {
      console.log('Closed ', record.title, ' (id ', key, ') w/ duration ', record.dur);
      return true;
    }, error_fmt('Object store set request failed'));
  }, error_fmt("Object store get request failed"));
}

function navigate_away(tabId, closeTime) {
  const tabIdStr = tabId.toString();
  return browser.storage.local.get([tabIdStr]).then((results) => {
    if (tabIdStr in results) {
      return set_close(results[tabIdStr][0], closeTime).then((isValid) => {
        return browser.storage.local.remove([tabIdStr]).then(() => {
          if (isValid) {
            return results[tabIdStr][0];
          } else {
            return null;
          }
        });
      })
    } else {
      return null;
    }
  })
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

browser.webNavigation.onCompleted.addListener(evt => {
  // Filter out any sub-frame related navigation event
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

  browser.storage.local.get([evt.tabId.toString()]).then((results) => {
    if (evt.tabId in results && results[evt.tabId][1] === pageName) {
      return;
    }

    return navigate_away(evt.tabId, accessTime).then((prev_key) => {
      if (pageName === undefined) {
        if (ENABLE_SESSIONS) {
          return browser.sessions.removeTabValue(evt.tabId, tabKey);
        } else {
          return;
        }
      }

      return add_record(pageName, accessTime, isSearch ? null : prev_key).then((key) => {
        const toSet = Object();
        toSet[evt.tabId.toString()] = [key, pageName];
        return browser.storage.local.set(toSet).then(() => {
          if (ENABLE_SESSIONS) {
            browser.sessions.setTabValue(evt.tabId, tabKey, [key, pageName]);
          }
        });
      })
    });
  });
}, {
  url: [{schemes: ["http", "https"]}]
});

browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
  navigate_away(tabId, new Date());
});

let data_url = undefined;
let page_url = undefined;

browser.action.onClicked.addListener((tab, onClickData) => {
  console.log('Hello World');
  const transaction = db.transaction([storeName], 'readonly');

  transaction.onerror = error_fmt("Download transaction failed");
  transaction.oncomplete = () => { console.log("Download transaction complete!")};

  const objectStore = transaction.objectStore(storeName);
  promisifyResult(objectStore.getAll()).then((data) => {
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
});