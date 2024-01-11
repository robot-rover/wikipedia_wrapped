const dbName = "wikipedia_wrapped";
const storeName = "history";
const storeVer = 1;
const tabKey = 'db_key';

console.log("Loaded Extension");

const DBOpenRequest = indexedDB.open(dbName, storeVer)
const ENABLE_SESSIONS = (browser.sessions !== undefined);

let db;

function promisifyResult(request) {
  return new Promise((resolve, reject) => {
      request.oncomplete = request.onsuccess = () => resolve(request.result);
      request.onabort = request.onerror = () => reject(request.error);
  });
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
      request.oncomplete = request.onsuccess = () => resolve(request);
      request.onabort = request.onerror = () => reject(request.error);
  });
}

function error_fmt(message) {
    return (event) => {
        console.error(message, event, event.stack);
    }
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

    const objectStore = db.createObjectStore(storeName, {autoIncrement: true});
    objectStore.createIndex("title", "title", { unique: false });
    objectStore.createIndex("time", "time", { unique: false });
    objectStore.createIndex("dur", "dur", { unique: false });
}

function add_record(pageName, accessTime, idCallback) {
  const transaction = db.transaction([storeName], 'readwrite');

  transaction.onerror = error_fmt("Database transaction failed");

  const objectStore = transaction.objectStore(storeName);
  const osAddReq = objectStore.add( { time: accessTime.toISOString(), title: pageName, dur: 0 } );
  osAddReq.onerror = error_fmt("Object store add request failed");
  osAddReq.onsuccess = (event) => {
    const id = osAddReq.result;
    console.log('Opened ', pageName, ' (id ', id,  ') at ', accessTime.toISOString());
    idCallback(id);
  };
}

function set_close(key, closeTime) {
  const transaction = db.transaction([storeName], 'readwrite');
  transaction.onerror = error_fmt("Database transaction failed");

  const objectStore = transaction.objectStore(storeName);
  const osGetReq = objectStore.get( key );
  osGetReq.onerror = error_fmt("Object store get request failed");
  osGetReq.onsuccess = (event) => {
    const record = osGetReq.result;
    record.dur = (closeTime - new Date(record.time)) / 1000;
    const osSetReq = objectStore.put(record, key);
    osSetReq.onsuccess = (event) => {
      console.log('Closed ', record.title, ' (id ', key, ') w/ duration ', record.dur);
    }
    osSetReq.onerror = error_fmt('Object Store set request failed')
  };
}

openTabs = Object();

function navigate_away(tabId) {
  if (tabId in openTabs) {
    set_close(openTabs[tabId][0], new Date());
    delete openTabs[tabId];
  }
}

if (ENABLE_SESSIONS) {
  browser.tabs.onCreated.addListener((tab) => {
    browser.sessions.getTabValue(tab.id, tabKey).then((key) => {
      if (key !== undefined) {
        openTabs[tab.id] = key;
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
  if (url.host.endsWith("wikipedia.org")) {
    const match = url.pathname.match(/^\/wiki\/(.+)$/);
    if (match !== null) {
      pageName = match[1];
    }
  }

  if (evt.tabId in openTabs && openTabs[evt.tabId][1] === pageName) {
    return;
  }

  navigate_away(evt.tabId);
  if (ENABLE_SESSIONS) {
    browser.sessions.removeTabValue(evt.tabId, tabKey);
  }

  if (pageName === undefined) {
    return;
  }

  const accessTime = new Date();

  add_record(pageName, accessTime, (key) => {
    openTabs[evt.tabId] = [key, pageName];
    if (ENABLE_SESSIONS) {
      browser.sessions.setTabValue(evt.tabId, tabKey, [key, pageName]);
    }
  })
}, {
  url: [{schemes: ["http", "https"]}]
});

const downloadIdSet = new Object();

browser.downloads.onChanged.addListener((delta) => {
  if (delta.state && delta.state.current === 'complete' && delta.id in downloadIdSet) {
    console.log('Download Finished');
    URL.revokeObjectURL(downloadIdSet[delta.id]);
    delete downloadIdSet[delta.id];
  }
})

browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
  navigate_away(tabId);
});

browser.action.onClicked.addListener((tab, onClickData) => {
  const transaction = db.transaction([storeName], 'readonly');

  transaction.onerror = error_fmt("Database transaction failed");
  transaction.oncomplete = () => { console.log("Transaction Complete!")};

  const objectStore = transaction.objectStore(storeName);
  const objectStoreRequest = objectStore.getAll();
  objectStoreRequest.onsuccess = (event) => {
    const data = objectStoreRequest.result;
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json', endings: 'native' } );
    const url = URL.createObjectURL(blob);

    browser.downloads.download({ url: url, filename: 'wikipedia_wrapped.json' }).then(
      (downloadId) => {
        console.log('Download Started');
        downloadIdSet[downloadId] = url;
      },
      () => {
        console.log('Download Canceled');
        URL.revokeObjectURL(url);
      }
    );
  };
});