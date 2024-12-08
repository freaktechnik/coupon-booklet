const STORE = 'coupons',
    DB_VERSION = 1,
    NONE = 0,
    WWW_PREFIX = 'www.',
    ONE_DAY_IN_MINUTES = 1440,
    ONE = 1,
    ZERO = 0,
    LISTENER_OPTS = {
        passive: true,
        once: true,
    };

function waitForRequest(requestInstance) {
    return new Promise((resolve, reject) => {
        requestInstance.addEventListener("success", resolve, LISTENER_OPTS);
        requestInstance.addEventListener("error", reject, LISTENER_OPTS);
    });
}

async function getDatabase() {
    const request = window.indexedDB.open(STORE, DB_VERSION);
    request.addEventListener("upgradeneeded", (event) => {
        const coupons = event.target.result.createObjectStore(STORE, {
            keyPath: 'id',
            autoIncrement: true,
        });
        coupons.createIndex('pagecoupon', [
            'coupon',
            'host',
        ], { unique: true });
        coupons.createIndex('page', 'host', { unique: false });
        coupons.createIndex('expires', 'expires', { unique: false });
    }, {
        once: true,
        passive: true,
    });
    const event = await waitForRequest(request);
    return event.target.result;
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

async function getCount(url, database) {
    if(!database) {
        database = await getDatabase();
    }
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
        cursorRequest.addEventListener("error", reject);
    });
}

async function updateTabCount(tab, database) {
    const count = await getCount(tab.url, database);
    browser.browserAction.setBadgeText({
        text: count > NONE ? count.toString() : '',
        tabId: tab.id,
    });
}

async function updateActiveTabs(database) {
    if(!database) {
        // Optimize database opening when iterating over tabs.
        database = await getDatabase(); // eslint-disable-line require-atomic-updates
    }
    const tabs = await browser.tabs.query({
        active: true,
    });
    return Promise.all(tabs.map((tab) => updateTabCount(tab, database)));
}

function runExpunge(database) {
    const expunger = new Worker(browser.runtime.getURL("worker.js"));
    expunger.addEventListener("message", () => {
        updateActiveTabs(database).catch(console.error);
    }, { passive: true });
}

async function init() {
    const now = new Date(),
        midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ONE, ZERO, ZERO, ZERO, ZERO);
    browser.alarms.create("expunge", {
        when: midnight.getTime(),
        periodInMinutes: ONE_DAY_IN_MINUTES,
    });
    const database = await getDatabase();

    runExpunge(database);
    await updateActiveTabs(database);
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
    urls: [ '<all_urls>' ],
});

browser.runtime.onInstalled.addListener((details) => {
    if(details.reason !== "browser_update") {
        init();
    }
});

browser.runtime.onStartup.addListener(() => {
    init();
});

browser.alarms.onAlarm.addListener((alarm) => {
    if(alarm.name !== "expunge") {
        return;
    }
    runExpunge();
});
