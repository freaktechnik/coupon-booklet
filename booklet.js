const LISTENER_OPTS = {
        once: true,
        passive: true,
    },
    STORE = 'coupons',
    DB_VERSION = 1,
    WWW_PREFIX = 'www.',
    DOUBLE_DIGIT = 2,
    ONE = 1,
    NONE = 0;

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
        return host.slice(WWW_PREFIX.length);
    }
    return host;
}

function getHost(url) {
    return (new URL(url)).hostname;
}

async function init() {
    const [ { target: { result: database } } ] = await Promise.all([
        Promise.try(() => {
            const request = globalThis.indexedDB.open(STORE, DB_VERSION);
            return waitForRequest(request);
        }),
        new Promise((resolve) => {
            document.addEventListener("DOMContentLoaded", resolve, LISTENER_OPTS);
        }),
    ]),
        now = new Date();
    document.querySelector("#expiryDate").min = `${now.getFullYear()}-${(now.getMonth() + ONE).toString().padStart(DOUBLE_DIGIT, '0')}-${now.getDate().toString()
        .padStart(DOUBLE_DIGIT, '0')}`;
    function showAdd() {
        document.querySelector("#addcoupon").hidden = false;
        document.querySelector("ul").hidden = true;
        document.querySelector("header").hidden = true;
        document.querySelector("#add").hidden = true;
        document.querySelector("#add").disabled = true;
    }

    function removeCoupon(id) {
        const transaction = database.transaction(STORE, 'readwrite'),
            store = transaction.objectStore(STORE),
            request = store.delete(id);
        waitForRequest(request)
            .then(loadCoupons) //eslint-disable-line no-use-before-define
            .catch(console.error);
    }

    async function buildList(coupons, list) {
        const [ currentTab ] = await browser.tabs.query({
                active: true,
                currentWindow: true,
            }),
            currentHost = ignoreWWW(getHost(currentTab.url));
        let addedSome = false,
            itemCount = 0;
        list.replaceChildren(...Object.entries(coupons).map(([
            host,
            items,
        ]) => {
            addedSome = true;
            const hostItem = document.createElement("li"),
                hostDetails = document.createElement("details"),
                hostSummary = document.createElement("summary"),
                mainTitle = document.createElement("span"),
                open = document.createElement("button"),
                couponCodes = document.createElement("ul");
            if(currentHost == ignoreWWW(host)) {
                hostItem.classList.add('current');
                itemCount += items.length;
                hostDetails.open = true;
            }
            mainTitle.classList.add('space');
            mainTitle.textContent = host;
            // This is a button and not a link because a link would open in a new window instead of a tab
            // and the button styles would havee to be manually ported to it.
            open.classList.add('browser-style');
            open.textContent = 'visit';
            open.title = browser.i18n.getMessage("open");
            open.addEventListener("click", (event) => {
                event.preventDefault();
                // Yes, we assume HTTPS here, but you shouldn't be shopping on HTTP sites to start with...
                browser.tabs.create({
                    url: `https://${host}`,
                })
                    .then(() => {
                        window.close();
                    })
                    .catch(console.error);
            }, {
                passive: false,
                once: true,
            });
            hostSummary.append(mainTitle, open);
            hostDetails.append(hostSummary);

            for(const code of items) {
                const codeItem = document.createElement("li"),
                    codeTitle = document.createElement("span"),
                    buttonGroup = document.createElement("span"),
                    copy = document.createElement("button"),
                    remove = document.createElement("button");
                codeTitle.classList.add('space');
                codeTitle.classList.add('code');
                codeTitle.textContent = code.coupon;

                if(code.expires > new Date(NONE)) {
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
                copy.textContent = "copy";
                copy.title = browser.i18n.getMessage("copy");
                copy.classList.add('browser-style');
                copy.classList.add('default');
                copy.addEventListener("click", () => {
                    navigator.clipboard.writeText(code.coupon);
                    //TODO tell the user that it was copied
                }, { passive: true });
                remove.textContent = '×';
                remove.title = browser.i18n.getMessage("delete");
                remove.classList.add('browser-style');
                remove.addEventListener("click", () => {
                    removeCoupon(code.id);
                }, { passive: true });
                buttonGroup.append(remove, copy);
                codeItem.append(codeTitle, buttonGroup);

                couponCodes.append(codeItem);
            }

            hostDetails.append(couponCodes);
            hostItem.append(hostDetails);

            return hostItem;
        }));
        if(!addedSome) {
            const empty = document.createElement("li");
            empty.textContent = browser.i18n.getMessage("empty");
            empty.classList.add("empty");
            list.append(empty);
        }
        browser.action.setBadgeText({
            text: itemCount > NONE ? itemCount.toString() : "",
            tabId: currentTab.id,
        });
    }

    function loadCoupons() {
        const list = document.querySelector("main > ul"),
            transaction = database.transaction(STORE),
            store = transaction.objectStore(STORE),
            request = store.openCursor(),
            coupons = {};

        request.addEventListener("success", (event) => {
            const cursor = event.target.result;
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
        request.addEventListener("error", (event) => {
            //TODO handle erros
            console.error(event);
        });
    }

    function hideAdd() {
        document.querySelector("#addcoupon").hidden = true;
        document.querySelector("ul").hidden = false;
        document.querySelector("header").hidden = false;
        document.querySelector("#add").hidden = false;
        document.querySelector("#add").disabled = false;
        document.querySelector("form").reset();
        loadCoupons();
    }

    function addCoupon(event) {
        event.preventDefault();
        const coupon = {
                coupon: document.querySelector("#code").value,
                host: getHost(document.querySelector("#website").value),
                notes: document.querySelector("#notes").value,
            },
            expiry = document.querySelector("#expiryDate");
        if(expiry.value) {
            coupon.expires = expiry.valueAsDate;
        }
        else {
            coupon.expires = new Date(NONE);
        }
        const transaction = database.transaction(STORE, 'readwrite'),
            store = transaction.objectStore(STORE),
            request = store.add(coupon);

        waitForRequest(request)
            .then(hideAdd)
            .catch(console.error);
    }

    // init
    document.querySelector("#add").addEventListener("click", showAdd, { passive: true });
    document.querySelector("form").addEventListener("submit", addCoupon, { passive: false });
    document.querySelector("#back").addEventListener("click", hideAdd, { passive: true });
    document.querySelector("#useCurrent").addEventListener("click", () => {
        browser.tabs.query({
            active: true,
            currentWindow: true,
        })
            .then((tabs) => {
                if(tabs.length) {
                    const [ firstTab ] = tabs;
                    document.querySelector("#website").value = firstTab.url;
                }
            })
            .catch(console.error);
    }, { passive: true });
    document.documentElement.addEventListener("toggle", (event) => {
        if(event.target.open) {
            const details = document.querySelectorAll("details");
            for(const detail of details) {
                if(!detail.isEqualNode(event.target) && detail.open) {
                    detail.open = false;
                }
            }
        }
    }, {
        passive: true,
        capture: true,
    });
    loadCoupons();
}
init().catch(console.error);
