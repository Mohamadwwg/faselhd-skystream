(function () {
    "use strict";
    console.log("SKYSTREAM GLOBALS:", Object.keys(globalThis).sort());
    const NAME = "FaselHD";

    function absoluteUrl(url) {
        if (!url) return "";
        if (url.startsWith("http://") || url.startsWith("https://")) {
            return url;
        }

        if (url.startsWith("//")) {
            return "https:" + url;
        }

        return new URL(url, manifest.baseUrl).href;
    }

    function cleanText(value) {
        if (!value) return "";

        return value
            .replace(/\\n/g, " ")
            .replace(/\n/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function firstMatch(text, regex) {
        const match = text.match(regex);
        return match ? match[1] : null;
    }

    async function getDocument(url, options = {}) {
        try {
            const baseUrl = manifest?.baseUrl || "https://www.faselhd.co"; // Fallback-Domain
            
            const headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
                "Referer": baseUrl + "/",
                "Sec-Ch-Ua": '"Not-A.Brand";v="99", "Chromium";v="124", "Google Chrome";v="124"',
                "Sec-Ch-Ua-Mobile": "?0",
                "Sec-Ch-Ua-Platform": '"Windows"',
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "same-origin",
                "Sec-Fetch-User": "?1",
                "Upgrade-Insecure-Requests": "1",
                ...(options.headers || {})
            };

            // Prüfe, ob SkyStream eine spezielle Bypass-Funktion hat (z. B. http_get_cloud)
            const httpFunc = typeof http_get_cloud === "function" ? http_get_cloud : http_get;

            const response = await httpFunc(url, {
                headers: headers
            });

            if (!response) {
                throw new Error("Empty HTTP response");
            }

            const html = typeof response === "string"
                ? response
                : response.body ?? response.data ?? String(response);

            // Prüfen, ob wir auf einer Cloudflare-Sperrseite gelandet sind
            if (html.includes("cf-challenge") || html.includes("Just a moment...") || html.includes("Attention Required!")) {
                console.error("CLOUDFLARE BLOCK DETECTED on URL:", url);
                throw new Error("Cloudflare protection triggered. Needs WebView/Cookie bypass.");
            }

            return html;

        } catch (error) {
            throw new Error(`HTTP GET failed: ${error}`);
        }
    }

    function parseAttributes(tag) {
        const attrs = {};

        const regex =
            /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

        let match;

        while ((match = regex.exec(tag)) !== null) {
            attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? "";
        }

        return attrs;
    }

    function stripHtml(html) {
        return cleanText(
            html
                .replace(/<script[\s\S]*?<\/script>/gi, "")
                .replace(/<style[\s\S]*?<\/style>/gi, "")
                .replace(/<[^>]+>/g, " ")
                .replace(/&nbsp;/gi, " ")
                .replace(/&amp;/gi, "&")
                .replace(/&quot;/gi, '"')
                .replace(/&#39;/gi, "'")
        );
    }

    function extractCards(html) {
        const results = [];

        /*
         * FaselHD currently exposes result cards using elements such as:
         * .postDiv
         * .blockMovie
         * article
         *
         * We intentionally parse the HTML without relying on a browser DOM.
         */

        const cardRegex =
            /<(?:div|article)[^>]*class=["'][^"']*(?:postDiv|blockMovie)[^"']*["'][\s\S]*?<\/(?:div|article)>/gi;

        const cards = html.match(cardRegex) || [];

        for (const card of cards) {
            const linkMatch = card.match(
                /<a[^>]+href=["']([^"']+)["'][^>]*>/i
            );

            if (!linkMatch) continue;

            const url = absoluteUrl(linkMatch[1]);

            const imageMatch = card.match(
                /<img[^>]+(?:data-src|src)=["']([^"']+)["']/i
            );

            const titleMatch =
                card.match(
                    /class=["'][^"']*(?:h1|h4|h5)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i
                ) ||
                card.match(
                    /<a[^>]*>([\s\S]*?)<\/a>/i
                );

            const title = stripHtml(titleMatch ? titleMatch[1] : "");

            if (!title || !url) continue;

            results.push(
                new MultimediaItem({
                    title,
                    url,
                    posterUrl: imageMatch
                        ? absoluteUrl(imageMatch[1])
                        : "",
                    type: "series"
                })
            );
        }

        return results;
    }

    function extractEpisodes(html, posterUrl) {
        const episodes = [];

        const epSection =
            html.match(
                /<div[^>]+id=["']epAll["'][^>]*>([\s\S]*?)<\/div>/i
            );

        if (!epSection) {
            return episodes;
        }

        const links = epSection[1].match(
            /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
        ) || [];

        for (const link of links) {
            const href = firstMatch(
                link,
                /href=["']([^"']+)["']/i
            );

            if (!href) continue;

            const name = stripHtml(
                firstMatch(
                    link,
                    />([\s\S]*?)<\/a>/i
                ) || ""
            );

            if (!name) continue;

            if (
                name.includes("باقي الحلقات") ||
                name.includes("المزيد")
            ) {
                continue;
            }

            const numberMatch = name.match(/\d+/);

            episodes.push(
                new Episode({
                    name,
                    url: absoluteUrl(href),
                    season: 1,
                    episode: numberMatch
                        ? Number(numberMatch[0])
                        : episodes.length + 1
                })
            );
        }

        return episodes;
    }

    function extractPoster(html) {
        const meta =
            html.match(
                /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/i
            );

        if (meta) {
            return absoluteUrl(meta[1]);
        }

        const poster =
            html.match(
                /<img[^>]+class=["'][^"']*poster[^"']*["'][^>]+src=["']([^"']+)["']/i
            );

        return poster ? absoluteUrl(poster[1]) : "";
    }

    function extractDescription(html) {
        const match =
            html.match(
                /class=["'][^"']*(?:singleDesc|story)[^"']*["'][\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i
            );

        return match ? stripHtml(match[1]) : "";
    }

    function extractTitle(html) {
        const match =
            html.match(
                /class=["'][^"']*singleInfo[^"']*["'][\s\S]*?class=["'][^"']*title[^"']*h1[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i
            );

        return match ? stripHtml(match[1]) : "";
    }

    function extractIframeUrls(html) {
        const urls = new Set();

        const iframeRegex =
            /<iframe[^>]+src=["']([^"']+)["']/gi;

        let match;

        while ((match = iframeRegex.exec(html)) !== null) {
            const url = absoluteUrl(match[1]);

            if (
                !url.includes("recaptcha") &&
                !url.includes("google.com/ads") &&
                !url.includes("googlesyndication")
            ) {
                urls.add(url);
            }
        }

        const onclickRegex =
            /player_iframe\.location\.href\s*=\s*["']([^"']+)["']/gi;

        while ((match = onclickRegex.exec(html)) !== null) {
            urls.add(absoluteUrl(match[1]));
        }

        return [...urls];
    }

    async function getHome(cb) {
        try {
            const html = await getDocument(
                `${manifest.baseUrl}/main`
            );

            const data = {};

            const blocks =
                html.match(
                    /<section[^>]+id=["']blockList["'][\s\S]*?<\/section>/gi
                ) || [];

            for (const block of blocks) {
                const titleMatch =
                    block.match(
                        /class=["'][^"']*blockHead[^"']*["'][\s\S]*?class=["'][^"']*h3[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i
                    );

                const title = titleMatch
                    ? stripHtml(titleMatch[1])
                    : "FaselHD";

                const items = extractCards(block);

                if (items.length) {
                    data[title] = items;
                }
            }

            if (!Object.keys(data).length) {
                data["FaselHD"] = extractCards(html);
            }

            cb({
                success: true,
                data
            });
        } catch (error) {
            console.error(`${NAME} getHome:`, error);

            cb({
                success: false,
                errorCode: "NETWORK_ERROR",
                message: String(error)
            });
        }
    }

    // Hilfsfunktion für alternative Karten-Strukturen (innerhalb der IIFE definieren!)
    function extractAjaxCardsFallback(html) {
        const results = [];
        if (!html || typeof html !== "string") return results;

        const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let match;

        while ((match = linkRegex.exec(html)) !== null) {
            const url = absoluteUrl(match[1]);
            const innerContent = match[2];

            const imgMatch = innerContent.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i);
            const title = stripHtml(innerContent);

            if (title && url && !url.includes("javascript:")) {
                results.push(
                    new MultimediaItem({
                        title: title,
                        url: url,
                        posterUrl: imgMatch ? absoluteUrl(imgMatch[1]) : "",
                        type: "movie"
                    })
                );
            }
        }

        return results;
    }

    async function search(query, cb) {
        try {
            const baseUrl = manifest?.baseUrl || "https://web31312x.faselhdx.bid";
            const searchUrl = `${baseUrl}/?s=${encodeURIComponent(query)}`;

            const headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Referer": baseUrl + "/",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            };

            const response = await http_get(searchUrl, { headers });
            const rawData = typeof response === "string" ? response : (response.body ?? response.data ?? String(response));

            // Prüfen, ob Cloudflare-Sperrseite zurückgegeben wurde
            if (rawData.includes("Just a moment...") || rawData.includes("cf-challenge")) {
                console.error("Cloudflare Challenge in CLI erhalten. Teste das Plugin direkt in der SkyStream App auf Android.");
                cb({
                    success: false,
                    errorCode: "CLOUDFLARE_BLOCKED",
                    message: "Cloudflare Turnstile challenge triggered."
                });
                return;
            }

            let items = extractCards(rawData);

            if (!items.length) {
                items = extractAjaxCardsFallback(rawData);
            }

            cb({
                success: true,
                data: items
            });

        } catch (error) {
            console.error(`${NAME} search failed:`, error);
            cb({
                success: false,
                errorCode: "NETWORK_ERROR",
                message: String(error)
            });
        }
    }

    async function load(url, cb) {
        try {
            const html = await getDocument(url);

            const title = extractTitle(html);

            if (!title) {
                cb({
                    success: false,
                    errorCode: "NOT_FOUND",
                    message: "Could not determine title"
                });
                return;
            }

            const posterUrl = extractPoster(html);
            const description = extractDescription(html);

            const episodes =
                extractEpisodes(html, posterUrl);

            const type =
                episodes.length > 0
                    ? "series"
                    : "movie";

            const item = new MultimediaItem({
                title,
                url,
                posterUrl,
                type,
                description
            });

            if (episodes.length) {
                item.episodes = episodes;
            }

            cb({
                success: true,
                data: item
            });
        } catch (error) {
            console.error(`${NAME} load:`, error);

            cb({
                success: false,
                errorCode: "NETWORK_ERROR",
                message: String(error)
            });
        }
    }

    async function loadStreams(url, cb) {
        try {
            const html = await getDocument(url);

            const iframeUrls =
                extractIframeUrls(html);

            if (!iframeUrls.length) {
                cb({
                    success: true,
                    data: []
                });
                return;
            }

            const streams = [];

            /*
             * IMPORTANT:
             * We only hand discovered public embed URLs to
             * SkyStream's supported extractor system.
             *
             * No Cloudflare/captcha bypass is performed here.
             */

            for (const iframeUrl of iframeUrls) {
                try {
                    if (typeof loadExtractor === "function") {
                        const extracted =
                            await loadExtractor(iframeUrl);

                        if (Array.isArray(extracted)) {
                            streams.push(...extracted);
                        }
                    }
                } catch (error) {
                    console.error(
                        `${NAME} extractor failed:`,
                        error
                    );
                }
            }

            /*
             * Some sources expose a direct HLS URL.
             * We accept it only when it is already present in the
             * page rather than trying to defeat an anti-bot layer.
             */

            const m3u8Regex =
                /https?:\/\/[^\s"'<>]+\.m3u8(?:\?[^\s"'<>]*)?/gi;

            const directLinks =
                html.match(m3u8Regex) || [];

            for (const streamUrl of directLinks) {
                if (
                    !streams.some(
                        stream => stream.url === streamUrl
                    )
                ) {
                    streams.push(
                        new StreamResult({
                            url: streamUrl,
                            quality: "Auto",
                            headers: {
                                Referer: url
                            }
                        })
                    );
                }
            }

            cb({
                success: true,
                data: streams
            });
        } catch (error) {
            console.error(`${NAME} loadStreams:`, error);

            cb({
                success: false,
                errorCode: "NETWORK_ERROR",
                message: String(error)
            });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();