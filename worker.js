const LISTENER_OPTS = {
    once: true,
    passive: true
};
const STORE = 'coupons';
const DAY = 86400000;

function waitForRequest(request) {
    return new Promise((resolve, reject) => {
        request.addEventListener("success", resolve, LISTENER_OPTS);
        request.addEventListener("error", reject, LISTENER_OPTS);
    });
}

function expunge(database) {
    const transaction = database.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const index = store.index('expires');
    const request = index.openCursor();
    const start = new Date(0);
    const end = new Date(Date.now() - DAY);
    return new Promise((resolve, reject) => {
        request.addEventListener("success", (e) => {
            const cursor = e.target.result;
            if(cursor) {
                if(cursor.value > start && cursor.value <= end) {
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

function timeout(database) {
    expunge(database).catch(console.error);
    setInterval(() => {
        expunge(database).catch(console.error);
    }, DAY);
}

function getUntilMidnight() {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    return midnight.getTime() - Date.now()
}

const request = indexedDB.open(STORE, 1);
waitForRequest(request)
    .then(({ target: { result: database } }) => {
        setTimeout(() => {
            timeout(database);
        }, getUntilMidnight());
        return expunge(database);
    })
    .catch(console.error);
