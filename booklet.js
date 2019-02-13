const LISTENER_OPTS = {
    once: true,
    passive: true
};
const STORE = 'coupons';
const WWW_PREFIX = 'www.';

//TODO context menu item that pre-fills add form with selection and current URL
//TODO option to define URL aliases
//TODO support coupon websites and pre-fill more info from that (content script)
//TODO support being loaded in a sidebar and communicating with a potential popup

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
    return (new URL(url)).hostname;
}

Promise.all([
    new Promise((resolve, reject) => {
        try {
            const request = window.indexedDB.open(STORE, 1);
            resolve(waitForRequest(request));
        }
        catch(e) {
            reject(e);
            // can't open DB
        }
    }),
    new Promise((resolve) => {
        document.addEventListener("DOMContentLoaded", resolve, LISTENER_OPTS);
    })
])
    .then(([ { target: { result: database } } ]) => {
        const now = new Date();
        document.querySelector("#expiryDate").min = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
        function showAdd() {
            document.querySelector("#addcoupon").hidden = false;
            document.querySelector("ul").hidden = true;
            document.querySelector("header").hidden = true;
            document.querySelector("#add").hidden = true;
        }

        function hideAdd() {
            document.querySelector("#addcoupon").hidden = true;
            document.querySelector("ul").hidden = false;
            document.querySelector("header").hidden = false;
            document.querySelector("#add").hidden = false;
            document.querySelector("form").reset();
            loadCoupons();
        }

        function addCoupon(e) {
            e.preventDefault();
            const coupon = {
                coupon: document.querySelector("#code").value,
                host: getHost(document.querySelector("#website").value),
                notes: document.querySelector("#notes").value
            };
            const expiry = document.querySelector("#expiryDate");
            if(expiry.value) {
                coupon.expires = expiry.valueAsDate;
            }
            else {
                coupon.expires = new Date(0);
            }
            const transaction = database.transaction(STORE, 'readwrite');
            const store = transaction.objectStore(STORE);
            const req = store.add(coupon);

            waitForRequest(req)
                .then(hideAdd)
                .catch(console.error);
        }

        function removeCoupon(id) {
            const transaction = database.transaction(STORE, 'readwrite');
            const store = transaction.objectStore(STORE);
            const req = store.delete(id);
            waitForRequest(req)
                .then(loadCoupons)
                .catch(console.error);
        }

        async function buildList(coupons, list) {
            const [ currentTab ] = await browser.tabs.query({
                active: true,
                currentWindow: true
            });
            const currentHost = ignoreWWW(getHost(currentTab.url));
            let addedSome = false;
            let itemCount = 0;
            for(const host in coupons) {
                if(coupons.hasOwnProperty(host)) {
                    addedSome = true;
                    const hostItem = document.createElement("li");
                    const hostDetails = document.createElement("details");
                    if(currentHost == ignoreWWW(host)) {
                        hostItem.classList.add('current');
                        itemCount += coupons[host].length;
                        hostDetails.open = true;
                    }
                    const hostSummary = document.createElement("summary");
                    const mainTitle = document.createElement("span");
                    mainTitle.classList.add('space');
                    mainTitle.textContent = host;
                    hostSummary.append(mainTitle);
                    const open = document.createElement("button");
                    open.classList.add('browser-style');
                    open.textContent = 'visit';
                    open.title = browser.i18n.getMessage("open");
                    open.addEventListener("click", (e) => {
                        e.preventDefault();
                        browser.tabs.create({
                            url: `https://${host}`
                        }).then(() => {
                            window.close();
                        });
                    }, { passive: false, once: true });
                    hostSummary.append(open);

                    hostDetails.append(hostSummary);

                    const couponCodes = document.createElement("ul");
                    for(const code of coupons[host]) {
                        const codeItem = document.createElement("li");
                        const codeTitle = document.createElement("span");
                        codeTitle.classList.add('space');
                        codeTitle.classList.add('code');
                        codeTitle.textContent = code.coupon;
                        codeItem.append(codeTitle);

                        const buttonGroup = document.createElement("span");
                        if(code.expires > new Date(0)) {
                            codeItem.title = browser.i18n.getMessage("valid", code.expires.toLocaleDateString());
                            buttonGroup.append(document.createTextNode('⏰'));
                        }
                        if(code.notes) {
                            if(codeItem.title) {
                                codeItem.title += ' - ';
                            }
                            codeItem.title += code.notes;
                            buttonGroup.append(document.createTextNode('🗒️'));
                        }

                        buttonGroup.classList.add('button-group');
                        const copy = document.createElement("button");
                        copy.textContent = "copy";
                        copy.title = browser.i18n.getMessage("copy");
                        copy.classList.add('browser-style');
                        copy.classList.add('default');
                        copy.addEventListener("click", () => {
                            navigator.clipboard.writeText(code.coupon);
                            //TODO tell the user that it was copied
                        }, { passive: true });
                        const remove = document.createElement("button");
                        remove.textContent = '×';
                        remove.title = browser.i18n.getMessage("delete");
                        remove.classList.add('browser-style');
                        remove.addEventListener("click", () => {
                            removeCoupon(code.id);
                        }, { passive: true });
                        buttonGroup.append(remove);
                        buttonGroup.append(copy);
                        codeItem.append(buttonGroup);

                        couponCodes.append(codeItem);
                    }

                    hostDetails.append(couponCodes);
                    hostItem.append(hostDetails)

                    list.append(hostItem);
                }
            }
            if(!addedSome) {
                const empty = document.createElement("li");
                empty.textContent = browser.i18n.getMessage("empty");
                empty.classList.add("empty");
                list.append(empty);
            }
            browser.browserAction.setBadgeText({
                text: itemCount > 0 ? itemCount.toString() : "",
                tabId: currentTab.id
            });
        }

        function loadCoupons() {
            const list = document.querySelector("main > ul");
            while(list.firstElementChild) {
                list.firstElementChild.remove();
            }

            const transaction = database.transaction(STORE);
            const store = transaction.objectStore(STORE);
            const request = store.openCursor();
            const coupons = {};

            request.addEventListener("success", (e) => {
                const cursor = e.target.result;
                if(cursor) {
                    const { value } = cursor;
                    let hostToUse = value.host;
                    if(coupons.hasOwnProperty(ignoreWWW(value.host))) {
                        hostToUse = ignoreWWW(value.host);
                    }
                    else if(!coupons.hasOwnProperty(hostToUse)) {
                        const withWWW = WWW_PREFIX + ignoreWWW(value.host);
                        if(coupons.hasOwnProperty(withWWW)) {
                            coupons[hostToUse] = coupons[withWWW];
                            delete coupons[withWWW];
                        }
                        else {
                            coupons[hostToUse] = [];
                        }
                    }
                    coupons[hostToUse].push(value);
                    cursor.continue();
                }
                else {
                    buildList(coupons, list).catch(console.error);
                }
            });
            request.addEventListener("error", (e) => {
                //TODO handle erros
                console.error(e);
            });
        }

        // init
        document.querySelector("#add").addEventListener("click", showAdd, { passive: true });
        document.querySelector("form").addEventListener("submit", addCoupon, { passive: false });
        document.querySelector("#back").addEventListener("click", hideAdd, { passive: true });
        document.documentElement.addEventListener("toggle", (e) => {
            if(e.target.open) {
                const details = document.querySelectorAll("details");
                for(const detail of details) {
                    if(!detail.isEqualNode(e.target) && detail.open) {
                        detail.open = false;
                    }
                }
            }
        }, {
            passive: true,
            capture: true
        });
        loadCoupons();
    })
    .catch(console.error);
