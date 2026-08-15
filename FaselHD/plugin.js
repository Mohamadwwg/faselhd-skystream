const cheerio = require('cheerio');

class FASELHD {
    constructor() {
        this.name = "FASELHD";
        this.mainUrl = "https://web31312x.faselhdx.bid";
        this.lang = "ar";
        this.userAgent = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
        this.redirectUrl = null;
    }

    getHeaders(referer = null) {
        const headers = {
            "User-Agent": this.userAgent,
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

    async getBaseUrl() {
        if (this.redirectUrl) return this.redirectUrl;
        try {
            const res = await fetch(this.mainUrl, { redirect: 'follow' });
            const url = new URL(res.url);
            this.redirectUrl = `${url.protocol}//${url.host}`;
            return this.redirectUrl;
        } catch (e) {
            return this.mainUrl;
        }
    }

    async smartGet(url, referer = null) {
        let cleanUrl = (!url.endsWith("/") && !url.split('/').pop().includes(".")) ? `${url}/` : url;
        const res = await fetch(cleanUrl, {
            method: 'GET',
            headers: this.getHeaders(referer)
        });
        const text = await res.text();
        return cheerio.load(text);
    }

    parseSearchResult($, element) {
        const el = $(element);
        const href = el.find("a").first().attr("href")?.trim();
        const title = el.find(".h1, .h4, .h5").first().text().trim();
        let posterUrl = el.find("img").first().attr("data-src") || el.find("img").first().attr("src");
        posterUrl = posterUrl?.trim();

        if (!href || !title) return null;
        
        return {
            name: title,
            url: href,
            posterUrl: posterUrl,
            type: "TvSeries"
        };
    }

    async getMainPage() {
        const $ = await this.smartGet(`${this.mainUrl}/main`);
        const lists = [];

        // Neueste Hinzufügungen (Slider)
        const sliderItems = [];
        $("#homeSlide .swiper-slide").each((i, el) => {
            const item = this.parseSearchResult($, el);
            if (item) {
                item.name = $(el).find(".h1 a").text().trim() || item.name;
                sliderItems.push(item);
            }
        });
        if (sliderItems.length > 0) {
            lists.push({ title: "أحدث الإضافات", items: sliderItems });
        }

        // Hauptblöcke
        $("section#blockList").each((i, block) => {
            const title = $(block).find(".blockHead .h3").first().text().trim();
            const items = [];
            $(block).find(".blockMovie, .postDiv, .epDivHome").each((j, el) => {
                const item = this.parseSearchResult($, el);
                if (item) items.push(item);
            });
            if (items.length > 0) lists.push({ title, items });
        });

        // Meistgesehen
        $("div.slider").each((i, block) => {
            const h4Text = $(block).find(".h4").text();
            if (h4Text && h4Text.includes("مشاهدة")) {
                const title = h4Text.trim() || "الأكثر مشاهدة";
                const items = [];
                $(block).find(".itemviews .postDiv").each((j, el) => {
                    const item = this.parseSearchResult($, el);
                    if (item) items.push(item);
                });
                if (items.length > 0) lists.push({ title, items });
            }
        });

        return lists;
    }

    async search(query, page = 1) {
        const base = await this.getBaseUrl();
        const encoded = encodeURIComponent(query);
        const searchUrl = page === 1 ? `${base}/?s=${encoded}` : `${base}/page/${page}/?s=${encoded}`;

        let $ = await this.smartGet(searchUrl, base);
        let items = [];

        $("div#postList div.postDiv, div.postDiv, article").each((i, el) => {
            const item = this.parseSearchResult($, el);
            if (item) items.push(item);
        });

        // Fallback über AJAX (dtc_live)
        if (items.length === 0 && page === 1) {
            try {
                const ajaxUrl = `${base}/wp-admin/admin-ajax.php`;
                const formData = new URLSearchParams();
                formData.append('action', 'dtc_live');
                formData.append('trsearch', query);

                const res = await fetch(ajaxUrl, {
                    method: 'POST',
                    headers: { ...this.getHeaders(searchUrl), 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: formData.toString()
                });
                
                const bodyStr = await res.text();
                if (bodyStr) {
                    $ = cheerio.load(bodyStr);
                    $("div.postDiv, article, .result, .search-item").each((i, el) => {
                        const item = this.parseSearchResult($, el);
                        if (item) items.push(item);
                    });
                }
            } catch (e) {
                console.error("AJAX Search Error:", e);
            }
        }
        return items;
    }

    async loadInfo(url) {
        const base = await this.getBaseUrl();
        const absoluteUrl = url.startsWith("/") ? `${base}${url}` : url;
        const $ = await this.smartGet(absoluteUrl);

        const rawTitle = $(".singleInfo .title.h1").first().contents().filter(function() {
            return this.nodeType === 3;
        }).text();
        const title = rawTitle.replace(/\\n|\n/g, "").trim();
        if (!title) return null;

        const plot = $(".singleDesc p, .story p").first().text().replace(/\\n|\n/g, " ").trim();
        const poster = $("meta[itemprop=image]").attr("content") || $(".posterImg img.poster").attr("src");
        
        let backgroundPoster = null;
        const style = $("div.singlePage").attr("style");
        if (style) {
            const match = style.match(/url\(['"]?(.*?)['"]?\)/);
            if (match && match[1]) backgroundPoster = match[1];
        }

        const episodes = [];
        $("div#epAll a").each((i, el) => {
            const epUrlRaw = $(el).attr("href")?.trim();
            if (epUrlRaw) {
                const epTitle = $(el).text().replace(/\\n|\n/g, "").trim();
                const epNumMatch = epTitle.match(/\d+/);
                const epNum = epNumMatch ? parseInt(epNumMatch[0]) : null;
                
                episodes.push({
                    name: epTitle,
                    episode: epNum,
                    season: 1,
                    url: epUrlRaw.startsWith("http") ? epUrlRaw : `${base}${epUrlRaw}`,
                });
            }
        });

        return {
            title,
            url: absoluteUrl,
            poster,
            backgroundPoster,
            plot,
            episodes: episodes
        };
    }

    // Native Entschlüsselung der Encrypted-URLs aus der Kotlin-Beispieldatei
    decryptUrl(url) {
        if (!url || !url.startsWith('enc:')) return url;
        const key1 = "V2@%YSU2B]G~";
        const key2 = "bv0fim4qf17";

        const ie = (c) => {
            const x = c.charCodeAt(0);
            if (x >= 97 && x <= 122) return x - 97;
            if (x >= 65 && x <= 90) return x - 65 + 26;
            if (x >= 48 && x <= 57) return x - 48 + 52;
            if (x === 43) return 62;
            if (x === 47) return 63;
            return 0;
        };
        const bn = (x) => {
            if (x <= 25) return String.fromCharCode(x + 97);
            if (x <= 51) return String.fromCharCode(x - 26 + 65);
            if (x <= 61) return String.fromCharCode(x - 52 + 48);
            if (x === 62) return '+';
            if (x === 63) return '/';
            return ' ';
        };
        const dec = (e, k) => {
            let r = '';
            for (let i = 0; i < e.length; i++) {
                const kc = k[i % (k.length - 1)];
                const M = ie(e[i]) - ie(kc);
                r += bn(M < 0 ? M + 64 : M);
            }
            return r;
        };
        try {
            return dec(dec(url.substring(4), key2), key1);
        } catch (e) {
            return url;
        }
    }

    async getLinks(url) {
        const $ = await this.smartGet(url);
        const iframeUrls = new Set();
        const blockedKeywords = ["google.com/recaptcha", "google.com/ads", "googlesyndication.com", "googletagmanager.com"];

        const addResult = (src) => {
            if (src && !blockedKeywords.some(k => src.includes(k))) iframeUrls.add(src);
        };

        $("iframe[src]").each((i, el) => addResult($(el).attr("src")));

        $("[onclick]").each((i, el) => {
            const onclick = $(el).attr("onclick");
            const match = onclick?.match(/player_iframe\.location\.href\s*=\s*['"]([^'"]+)['"]/);
            if (match) addResult(match[1]);
        });

        const links = [];

        for (let iframeUrl of iframeUrls) {
            if (!iframeUrl.startsWith("http")) continue;

            try {
                const frameRes = await fetch(iframeUrl, {
                    headers: this.getHeaders(url)
                });
                const frameText = await frameRes.text();
                
                const sourceMatches = frameText.match(/file\s*:\s*['"]([^'"]+)['"]/g);
                
                if (sourceMatches) {
                    sourceMatches.forEach(match => {
                        const fileMatch = match.match(/['"]([^'"]+)['"]/);
                        if (fileMatch && fileMatch[1]) {
                            let streamUrl = fileMatch[1];
                            
                            if (streamUrl.startsWith('enc:')) {
                                streamUrl = this.decryptUrl(streamUrl);
                            }

                            if (streamUrl.includes('.m3u8')) {
                                links.push({
                                    url: streamUrl,
                                    quality: 'Auto',
                                    isM3U8: true,
                                    headers: { "Referer": iframeUrl, "User-Agent": this.userAgent }
                                });
                            }
                        }
                    });
                }
            } catch (e) {
                console.error("Iframe fetch error:", iframeUrl, e);
            }
        }
        return links;
    }
}

module.exports = FASELHD;