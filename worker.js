const LISTENER_OPTS = {
        once: true,
        passive: true,
    },
    STORE = 'coupons',
    DAY = 86400000,
    ZERO = 0,
    DB_VERSION = 1;

function waitForRequest(request) {
    return new Promise((resolve, reject) => {
        request.addEventListener("success", resolve, LISTENER_OPTS);
        request.addEventListener("error", reject, LISTENER_OPTS);
    });
}

function expunge(database) {
    const transaction = database.transaction(STORE, 'readwrite'),
        store = transaction.objectStore(STORE),
        index = store.index('expires'),
        request = index.openCursor(),
        start = new Date(ZERO),
        end = new Date(Date.now() - DAY);
    return new Promise((resolve, reject) => {
        request.addEventListener("success", (event) => {
            const cursor = event.target.result;
            if(cursor) {
                if(cursor.value.expires > start && cursor.value.expires <= end) {
                    waitForRequest(cursor.delete()).catch(console.error);
                }
                cursor.continue();
            }
            else {
                resolve();
                postMessage("expunged");
            }
        });
        request.addEventListener("error", reject);
    });
}

const request = indexedDB.open(STORE, DB_VERSION);
waitForRequest(request)
    .then(({ target: { result: database } }) => expunge(database))
    .catch(console.error);
