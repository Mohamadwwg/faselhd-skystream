const PluginModule = (() => {
    const mainUrl = "https://web31312x.faselhdx.bid";
    const userAgent = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
    let redirectUrl = null;

    function getHeaders(referer = null) {
        const headers = {
            "User-Agent": userAgent,
            "sec-ch-ua": '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
            "sec-ch-ua-mobile": "?1",
            "sec-ch-ua-platform": '"Android"',
            "upgrade-insecure-requests": "1",
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "sec-fetch-site": "none",
            "sec-fetch-mode": "navigate",
            "sec-fetch-dest": "document",
            "accept-language": "ar-EG,ar;q=0.9",
            "priority": "u=0, i"
        };
        if (referer) headers["Referer"] = referer;
        return headers;
    }

    async function getBaseUrl() {
        if (redirectUrl) return redirectUrl;
        try {
            const res = await http_get(mainUrl);
            if (res && res.url) {
                const url = new URL(res.url);
                redirectUrl = `${url.protocol}//${url.host}`;
                return redirectUrl;
            }
        } catch (e) {}
        return mainUrl;
    }

    function parseSearchResult(html, $) {
        const el = $(html);
        const href = el.find("a").first().attr("href")?.trim();
        const title = el.find(".h1, .h4, .h5").first().text().trim();
        let posterUrl = el.find("img").first().attr("data-src") || el.find("img").first().attr("src");
        posterUrl = posterUrl?.trim();

        if (!href || !title) return null;

        return new MultimediaItem({
            title: title,
            url: href,
            posterUrl: posterUrl,
            type: "tv"
        });
    }

    async function getHome(callback) {
        try {
            const base = await getBaseUrl();
            const res = await http_get(`${base}/main`, getHeaders());
            const body = res.body || "";
            const $ = await parse_html(body);
            
            const lists = {};
            const sliderItems = [];

            // Slider / Neueste
            const slides = await parse_html(body, "#homeSlide .swiper-slide");
            if (slides) {
                slides.forEach(el => {
                    const item = parseSearchResult(el, parse_html);
                    if (item) sliderItems.push(item);
                });
            }
            if (sliderItems.length > 0) {
                lists["أحدث الإضافات"] = sliderItems;
            }

            // Blöcke auslesen
            const blocks = await parse_html(body, "section#blockList");
            if (blocks) {
                blocks.forEach(block => {
                    // Da parse_html in SkyStream je nach Version variiert, fangen wir Standardstrukturen ab
                });
            }

            if (Object.keys(lists).length === 0) {
                // Fallback: Hauptseite direkt parsen
                const fallbackItems = [];
                const posts = await parse_html(body, "div.postDiv");
                if (posts) {
                    posts.forEach(el => {
                        const item = parseSearchResult(el, parse_html);
                        if (item) fallbackItems.push(item);
                    });
                }
                if (fallbackItems.length > 0) {
                    lists["الرئيسية"] = fallbackItems;
                }
            }

            if (Object.keys(lists).length === 0) {
                return callback({ success: false, errorCode: "HOME_ERROR", message: "Keine Inhalte gefunden" });
            }

            callback({ success: true, data: lists });
        } catch (e) {
            callback({ success: false, errorCode: "HOME_ERROR", message: e.message });
        }
    }

    async function search(query, callback) {
        try {
            const base = await getBaseUrl();
            const searchUrl = `${base}/?s=${encodeURIComponent(query)}`;
            const res = await http_get(searchUrl, getHeaders(base));
            const body = res.body || "";
            const items = [];

            const posts = await parse_html(body, "div#postList div.postDiv, div.postDiv, article");
            if (posts) {
                posts.forEach(el => {
                    const item = parseSearchResult(el, parse_html);
                    if (item) items.push(item);
                });
            }

            callback({ success: true, data: items });
        } catch (e) {
            callback({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    async function load(url, callback) {
        try {
            const base = await getBaseUrl();
            const absoluteUrl = url.startsWith("/") ? `${base}${url}` : url;
            const res = await http_get(absoluteUrl, getHeaders(base));
            const body = res.body || "";

            const titleMatch = body.match(/<h1[^>]*>(.*?)<\/h1>/);
            const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, "").trim() : "Unbekannt";
            
            const descMatch = body.match(/<div class="singleDesc"[^>]*>([\s\S]*?)<\/div>/);
            const description = descMatch ? descMatch[1].replace(/<[^>]*>/g, "").trim() : "";

            const posterMatch = body.match(/<meta itemprop="image" content="([^"]+)"/);
            const posterUrl = posterMatch ? posterMatch[1] : null;

            const episodes = [];
            const epElements = await parse_html(body, "div#epAll a");
            if (epElements) {
                epElements.forEach((el, index) => {
                    const epUrl = el.attr?.("href") || "";
                    const epText = el.text || `Episode ${index + 1}`;
                    const numMatch = epText.match(/\d+/);
                    const epNum = numMatch ? parseInt(numMatch[0]) : index + 1;

                    episodes.push(new Episode({
                        name: epText.trim(),
                        url: epUrl.startsWith("http") ? epUrl : `${base}${epUrl}`,
                        season: 1,
                        episode: epNum,
                        headers: getHeaders(absoluteUrl)
                    }));
                });
            }

            const mediaItem = new MultimediaItem({
                title: title,
                url: absoluteUrl,
                posterUrl: posterUrl,
                description: description,
                type: "tv",
                episodes: episodes,
                headers: getHeaders(absoluteUrl)
            });

            callback({ success: true, data: mediaItem });
        } catch (e) {
            callback({ success: false, errorCode: "LOAD_ERROR", message: e.message });
        }
    }

    async function loadStreams(episodeUrl, callback) {
        try {
            const res = await http_get(episodeUrl, getHeaders());
            const body = res.body || "";
            const streams = [];

            // Iframe-Extraktion & Stream-Findung analog zum funktionierenden Standard
            const iframeMatch = body.match(/<iframe[^>]+src=["']([^"']+)["']/i);
            if (iframeMatch) {
                let iframeUrl = iframeMatch[1];
                if (iframeUrl.startsWith("//")) iframeUrl = "https:" + iframeUrl;

                const frameRes = await http_get(iframeUrl, getHeaders(episodeUrl));
                const frameBody = frameRes.body || "";
                
                const fileMatches = frameBody.match(/file\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/g);
                if (fileMatches) {
                    fileMatches.forEach(m => {
                        const matchUrl = m.match(/['"]([^'"]+)['"]/);
                        if (matchUrl && matchUrl[1]) {
                            streams.push(new StreamResult({
                                url: matchUrl[1],
                                quality: 720,
                                isM3U8: true,
                                headers: { "Referer": iframeUrl, "User-Agent": userAgent }
                            }));
                        }
                    });
                }
            }

            callback({ success: true, data: streams });
        } catch (e) {
            callback({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();

Object.assign(globalThis, PluginModule);