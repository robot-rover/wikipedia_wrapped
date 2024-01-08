const dbName = "wikipedia_wrapped";
const storeName = "history";
const storeVer = 1;

console.log("Loaded Extension");

const DBOpenRequest = indexedDB.open(dbName, storeVer)

let db;

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

    const objectStore = db.createObjectStore(storeName, {keyPath: "id", autoIncrement: true});
    objectStore.createIndex("title", "title", { unique: false });
    objectStore.createIndex("time", "time", { unique: true });
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

  console.log("Starting Transaction");
  const transaction = db.transaction([storeName], 'readwrite');

  transaction.onerror = error_fmt("Database transaction failed");
  transaction.oncomplete = () => { console.log("Transaction Complete!")};

  const objectStore = transaction.objectStore(storeName);
  const objectStoreRequest = objectStore.add( { time: accessTime, title: pageName } );
  objectStoreRequest.onsuccess = (event) => { console.log("OSR Success!")};

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

browser.browserAction.onClicked.addListener((tab, onClickData) => {
  const transaction = db.transaction([storeName], 'readonly');

  transaction.onerror = error_fmt("Database transaction failed");
  transaction.oncomplete = () => { console.log("Transaction Complete!")};

  const objectStore = transaction.objectStore(storeName);
  const objectStoreRequest = objectStore.getAll();
  objectStoreRequest.onsuccess = (event) => {
    const data = objectStoreRequest.result;
    for (const row of data) {
      delete row.id;
    }
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