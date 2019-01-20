const STORE = 'coupons';
const WWW_PREFIX = 'www.';
const LISTENER_OPTS = { passive: true, once: true };
const request = window.indexedDB.open(STORE, 1);
let database;
request.addEventListener("upgradeneeded", (e) => {
    const coupons = e.target.result.createObjectStore(STORE, {
        keyPath: 'id',
        autoIncrement: true
    });
    coupons.createIndex('pagecoupon', [
        'coupon',
        'host'
    ], { unique: true });
    coupons.createIndex('page', 'host', { unique: false });
    coupons.createIndex('expires', 'expires', { unique: false });
}, { once: true, passive: true });
waitForRequest(request)
    .then((e) => {
        database = e.target.result;
        const expunger = new Worker(browser.runtime.getURL("worker.js"));
        expunger.addEventListener("message", () => {
            updateActiveTabs().catch(console.error);
        }, { passive: true });

        return updateActiveTabs();
    })
    .catch(console.error);

function waitForRequest(request) {
    return new Promise((resolve, reject) => {
        request.addEventListener("success", resolve, LISTENER_OPTS);
        request.addEventListener("error", reject, LISTENER_OPTS);
    });
}

function ignoreWWW(host) {
    if(host.startsWith(WWW_PREFIX)) {
        return host.substr(WWW_PREFIX.length);
    }
    return host;
}

function getHost(url) {
    return ignoreWWW((new URL(url)).hostname);
}

function getCount(url) {
    const host = getHost(url);
    const transaction = database.transaction(STORE);
    const store = transaction.objectStore(STORE);
    const index = store.index('page');
    const request = index.openCursor();
    return new Promise((resolve, reject) => {
        let count = 0;
        request.addEventListener("success", (e) => {
            const cursor = e.target.result;
            if(cursor) {
                if(ignoreWWW(cursor.value.host) == host) {
                    ++count;
                }
                cursor.continue();
            }
            else {
                resolve(count);
            }
        });
        request.addEventListener("error", reject);
    });
}

async function updateTabCount(tab) {
  const count = await getCount(tab.url);
  browser.browserAction.setBadgeText({
      text: count > 0 ? count.toString() : '',
      tabId: tab.id
  });
}

async function updateActiveTabs() {
    const tabs = await browser.tabs.query({
        active: true
    });
    return Promise.all(tabs.map(updateTabCount));
}

browser.tabs.onActivated.addListener(async ({ tabId }) => {
    const tab = await browser.tabs.get(tabId);
    updateTabCount(tab);
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if(changeInfo.url && tab.active) {
        updateTabCount(tab);
    }
}, {
    urls: [ '<all_urls>' ]
});
