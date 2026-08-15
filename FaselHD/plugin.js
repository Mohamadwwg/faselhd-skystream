(function () {
    "use strict";
    const NAME = "FaselHD";

    function getBaseUrl() {
        if (typeof manifest !== "undefined" && manifest && manifest.baseUrl) {
            return manifest.baseUrl.replace(/\/+$/, "");
        }
        return "https://web31312x.faselhdx.bid";
    }

    function absoluteUrl(url) {
        if (!url) return "";
        if (url.startsWith("http://") || url.startsWith("https://")) return url;
        if (url.startsWith("//")) return "https:" + url;
        return new URL(url, getBaseUrl()).href;
    }

    function cleanText(value) {
        if (!value) return "";
        return value.replace(/\\n/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    }

    function stripHtml(html) {
        if (!html) return "";
        return cleanText(
            html
                .replace(/<script[\s\S]*?<\/script>/gi, "")
                .replace(/<style[\s\S]*?<\/style>/gi, "")
                .replace(/<[^>]+>/g, " ")
                .replace(/&nbsp;/gi, " ")
                .replace(/&amp;/gi, "&")
                .replace(/&#038;/gi, "&")
                .replace(/&quot;/gi, '"')
                .replace(/&#39;/gi, "'")
                .replace(/&#8217;/gi, "'")
                .replace(/&#8211;/gi, "-")
        );
    }

    async function getDocument(url) {
        try {
            const baseUrl = getBaseUrl();
            
            const headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
                "Referer": baseUrl + "/"
            };

            const httpFunc = typeof http_get_cloud === "function" ? http_get_cloud : http_get;
            const response = await httpFunc(url, { headers });

            if (!response) throw new Error("Empty HTTP response");

            const html = typeof response === "string" 
                ? response 
                : response.body ?? response.data ?? String(response);

            return html;
        } catch (error) {
            throw new Error(`HTTP GET failed: ${error.message || error}`);
        }
    }

    function extractCards(html) {
        const results = [];
        const matches = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi) || [];

        for (const block of matches) {
            const hrefMatch = block.match(/href=["']([^"']+)["']/i);
            const imgMatch = block.match(/<img[^>]+(?:data-src|src|data-lazy-src)=["']([^"']+)["']/i);
            const titleMatch = block.match(/alt=["']([^"']+)["']/i) 
                            || block.match(/title=["']([^"']+)["']/i)
                            || block.match(/<div[^>]*class=["'][^"']*h[1-6][^"']*["'][^>]*>([\s\S]*?)<\/div>/i);

            if (hrefMatch && imgMatch) {
                const rawUrl = hrefMatch[1];
                const url = absoluteUrl(rawUrl);
                const title = titleMatch ? stripHtml(titleMatch[1] || titleMatch[2]) : "";
                const posterUrl = absoluteUrl(imgMatch[1]);

                const isValidContent = rawUrl.includes("/movies") || rawUrl.includes("/series") || rawUrl.includes("/episodes") || rawUrl.includes("/seasons") || rawUrl.includes("/watch");
                const isNav = title === "الذهاب للرئيسية" || posterUrl.includes("logo-1.png") || title.length < 2;

                if (isValidContent && !isNav && !results.some(item => item.url === url)) {
                    results.push(new MultimediaItem({
                        title: title || "FaselHD Title",
                        url: url,
                        posterUrl: posterUrl,
                        type: (url.includes("series") || url.includes("episodes")) ? "series" : "movie"
                    }));
                }
            }
        }

        return results;
    }

    async function getHome(cb) {
        try {
            const baseUrl = getBaseUrl();
            let html = await getDocument(`${baseUrl}/all-movies`);
            let items = extractCards(html);

            if (items.length === 0) {
                html = await getDocument(`${baseUrl}/`);
                items = extractCards(html);
            }

            if (items.length > 0) {
                const data = {
                    "Trending": items.slice(0, 10),
                    "Neu auf FaselHD": items.slice(10)
                };
                cb({ success: true, data });
            } else {
                const snippet = stripHtml(html).substring(0, 200);
                throw new Error(`Keine Filme gefunden. Inhalt der Seite: "${snippet}"`);
            }
        } catch (error) {
            console.error(`${NAME} getHome Error:`, error);
            cb({ success: false, errorCode: "NETWORK_ERROR", message: String(error) });
        }
    }

    async function search(query, cb) {
        try {
            const baseUrl = getBaseUrl();
            const cleanQuery = query.trim();

            let searchUrl = `${baseUrl}/search/${encodeURIComponent(cleanQuery)}`;
            let html = await getDocument(searchUrl);
            let items = extractCards(html);

            if (!items || items.length === 0) {
                searchUrl = `${baseUrl}/?s=${encodeURIComponent(cleanQuery)}`;
                html = await getDocument(searchUrl);
                items = extractCards(html);
            }

            cb({ success: true, data: items });
        } catch (error) {
            cb({ success: false, errorCode: "NETWORK_ERROR", message: String(error) });
        }
    }

    async function load(url, cb) {
        try {
            const html = await getDocument(url);

            let posterUrl = 
                html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)?.[1] ||
                html.match(/<div\s+class=["'][^"']*poster[^"']*["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/i)?.[1] ||
                html.match(/<div\s+class=["'][^"']*poster[^"']*["'][^>]*>[\s\S]*?<img[^>]+data-src=["']([^"']+)["']/i)?.[1] ||
                "";

            let description = 
                html.match(/<div\s+class=["'][^"']*(?:single-desc|story|post-story|description)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
                html.match(/<meta\s+(?:property|name)=["'](?:og:description|description)["']\s+content=["']([^"']+)["']/i)?.[1] || 
                "";

            description = stripHtml(description);

            let rawTitle = html.match(/<title>([^<]+)<\/title>/i)?.[1] || "";
            let title = stripHtml(rawTitle).replace(/\s*-\s*فاصل إعلاني.*/i, "").trim();

            const streams = [];
            const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
            if (iframeMatch) {
                streams.push({
                    name: "FaselHD Player",
                    url: iframeMatch[1],
                    type: "hls"
                });
            }

            const data = {
                type: "movie",
                status: "ongoing",
                playbackPolicy: "none",
                isAdult: false,
                streams: streams,
                syncData: {},
                title: title || rawTitle,
                url: url,
                posterUrl: posterUrl,
                description: description
            };

            cb({ success: true, data: data });
        } catch (error) {
            cb({ success: false, errorCode: "NETWORK_ERROR", message: String(error) });
        }
    }

    async function resolveStream(url, cb) {
        try {
            const html = await getDocument(url);

            // Verschiedene Regex-Muster für Stream-URLs auf FaselHD
            const streamMatch = 
                html.match(/["'](?<url>https?:\/\/[^"']+\.m3u8[^"']*)["']/i) ||
                html.match(/file:\s*["'](?<url>[^"']+)["']/i) ||
                html.match(/src:\s*["'](?<url>[^"']+)["']/i) ||
                html.match(/<source[^>]+src=["'](?<url>[^"']+)["']/i);

            const directUrl = streamMatch?.groups?.url || streamMatch?.[1];

            if (directUrl && directUrl.startsWith("http")) {
                cb({
                    success: true,
                    data: {
                        url: directUrl,
                        type: directUrl.includes(".m3u8") ? "hls" : "mp4",
                        headers: {
                            "Referer": getBaseUrl() + "/",
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                        }
                    }
                });
            } else {
                // Fallback auf die Iframe-/Player-URL
                cb({
                    success: true,
                    data: {
                        url: url,
                        type: "hls",
                        headers: {
                            "Referer": getBaseUrl() + "/"
                        }
                    }
                });
            }
        } catch (error) {
            cb({ success: false, errorCode: "NETWORK_ERROR", message: String(error) });
        }
    }

    async function loadStreams(url, cb) {
        cb({ success: true, data: [] });
    }

    // Registrierung im Skystream-Umfeld
    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.resolveStream = resolveStream;
    globalThis.loadStreams = loadStreams;

    if (typeof module !== "undefined" && module.exports) {
        module.exports = {
            getHome,
            search,
            load,
            resolveStream,
            loadStreams
        };
    }
})();