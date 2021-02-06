const STORE = 'coupons',
    DB_VERSION = 1,
    NONE = 0,
    WWW_PREFIX = 'www.',
    LISTENER_OPTS = {
        passive: true,
        once: true
    },
    request = window.indexedDB.open(STORE, DB_VERSION);
let database;
request.addEventListener("upgradeneeded", (event) => {
    const coupons = event.target.result.createObjectStore(STORE, {
        keyPath: 'id',
        autoIncrement: true
    });
    coupons.createIndex('pagecoupon', [
        'coupon',
        'host'
    ], { unique: true });
    coupons.createIndex('page', 'host', { unique: false });
    coupons.createIndex('expires', 'expires', { unique: false });
}, {
    once: true,
    passive: true
});

function waitForRequest(requestInstance) {
    return new Promise((resolve, reject) => {
        requestInstance.addEventListener("success", resolve, LISTENER_OPTS);
        requestInstance.addEventListener("error", reject, LISTENER_OPTS);
    });
}

function ignoreWWW(host) {
    if(host.startsWith(WWW_PREFIX)) {
        return host.slice(WWW_PREFIX.length);
    }
    return host;
}

function getHost(url) {
    return ignoreWWW((new URL(url)).hostname);
}

function getCount(url) {
    const host = getHost(url),
        transaction = database.transaction(STORE),
        store = transaction.objectStore(STORE),
        index = store.index('page'),
        cursorRequest = index.openCursor();
    return new Promise((resolve, reject) => {
        let count = 0;
        cursorRequest.addEventListener("success", (event) => {
            const cursor = event.target.result;
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
        text: count > NONE ? count.toString() : '',
        tabId: tab.id
    });
}

async function updateActiveTabs() {
    const tabs = await browser.tabs.query({
        active: true
    });
    return Promise.all(tabs.map(updateTabCount));
}

waitForRequest(request)
    .then((event) => {
        database = event.target.result;
        const expunger = new Worker(browser.runtime.getURL("worker.js"));
        expunger.addEventListener("message", () => {
            updateActiveTabs().catch(console.error);
        }, { passive: true });

        return updateActiveTabs();
    })
    .catch(console.error);

browser.tabs.onActivated.addListener(async ({ tabId }) => {
    const tab = await browser.tabs.get(tabId);
    updateTabCount(tab);
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if(changeInfo.url && tab.active) {
        updateTabCount(tab);
    }
}, {
    urls: [ '<all_urls>' ] // eslint-disable-line xss/no-mixed-html
});
