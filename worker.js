const LISTENER_OPTS = {
    once: true,
    passive: true
};
const STORE = 'coupons';

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
    const end = new Date(Date.now() - 86400000);
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

const request = indexedDB.open(STORE, 1);
//TODO should expunge every midnight
waitForRequest(request)
    .then(({ target: { result: database } }) => expunge(database))
    .catch(console.error);
